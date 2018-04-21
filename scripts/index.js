#!/usr/bin/env node

const ChildProcess = require('child_process')

//const DNS = require('dns')
const FS = require('fs')
const OS = require('os')
const Path = require('path')

const chalk = require('chalk')
const commander = require('commander')
const fetch = require('node-fetch')
const semver = require('semver')

const packageJSON = require('../package.json')
//const Client = require('../support/CiscoTools.js')

// if there are other known paths to look for scripts, do that here:
const resolveScript = (...args) => Path.resolve(__dirname, ...args)

const oldDEBUG = process.env.DEBUG || '' // usage: https://www.npmjs.com/package/debug
const ourDEBUG = oldDEBUG ? `${oldDEBUG},${packageJSON.name}*` : `${packageJSON.name}*`
const unhandledRejections = new Map() // Promise => Error (for parent Process only)

// returns a ChildProcess instance (currently via .fork)
// (will run with the same environment as the current module)
const asyncChild = async (parent, modulePath, ...args) => {
	try {
		const options = {
			cwd: parent.cwd(),
			env: parent.env,
			stdio: 'inherit',
		}
		const child = ChildProcess.fork(modulePath, args, options)
		// can listen for unhandledRejection from child?
		child.once('exit', (code, signal) => {
			if (signal) parent.exitCode = 1
			else parent.exitCode = code
		})
		return child
	} catch (error) {
		parent.exitCode = 1
		throw error
	}
}

// run an elaborate (but reasonable) sequence setup tasks
// (reasonable means fast and makes sense on every command)
const asyncParent = async (parent, env = parent.env) => {
	const DEFAULT_DIRECTORY_PATH = Path.resolve(OS.homedir(), `.${packageJSON.name}`)
	const SECRETS_JSON_PATH = Path.resolve(DEFAULT_DIRECTORY_PATH, 'secrets.json')
	// N.B. tutorial saves Authorization in ~/.${packageJSON.name}/secrets.json
	const setupSecrets = async (secretsPath = SECRETS_JSON_PATH) => {
		if (!env.CISCOSPARK_ACCESS_TOKEN) {
			const secrets = JSON.parse(FS.readFileSync(secretsPath))
			const token = secrets.authorization.access_token
			if (token) env.CISCOSPARK_ACCESS_TOKEN = token
			else throw new Error('missing access token')
		}
		// this check is too slow (introduces one second-ish delay in REPL)
		/*
		const tools = ClientTools.fromAccessToken(env.CISCOSPARK_ACCESS_TOKEN)
		await tools.getPersonDetails() // otherwise, can't do much of anything
		*/
		// can determine if user is online/offline using node built-in method?
	}
	const newerVersion = async () => { // non-invasive (max 1s) update check
		if (Math.random() < 0.9) return // no-op usually, only check w/ p=10%
		const registryURL = `https://registry.npmjs.org/${packageJSON.name}`
		const response = await fetch(registryURL, { timeout: 1000 })
		if (!response.ok) throw new Error(`failed: GET ${registryURL}`)
		const { 'dist-tags': { latest } } = await response.json()
		return latest
	}
	/*
	// this check is fast-ish (but bad signal?)
	const offline = await new Promise((done) => {
		// hostname and options are not decided
		DNS.lookup('cisco.com', {}, (error) => {
			if (error) done(error)
			else done()
		})
	})
	// is there a cross-platform method?
	// eslint-disable-next-line no-console
	if (offline) console.error(offline)
	*/
	parent.exitCode = 0 // explicitly optimistic outcome(s):
	const tasks = {
		newerVersion: await newerVersion().catch(error => error),
		setupSecrets: await setupSecrets().catch(error => error),
	}
	await new Promise((resolve, reject) => {
		parent.once('beforeExit', () => {
			const defaultReason = new Error('Abnormal script termination!')
			const [firstReason] = [...unhandledRejections.values()]
			if (parent.exitCode === 0 && !firstReason) resolve()
			else reject(firstReason || defaultReason) //
		})
		parent.on('rejectionHandled', (promise) => {
			unhandledRejections.delete(promise)
		})
		parent.on('unhandledRejection', (reason, promise) => {
			unhandledRejections.set(promise, reason)
		})
		tasks.parseCommands = commander.parse(parent.argv)
	})
	return tasks
}

commander._name = chalk.bold(packageJSON.name || 'cisco-webex-tools')
commander.version(packageJSON.version || 'unknown', '-v, --version')

commander.command('developer-features [key] [value]').alias('df')
	.description(chalk.blue('list/get/set which special functionality your user has toggled (enabled/disabled)'))
	.option('-d, --debug', `with DEBUG=${ourDEBUG} (verbose mode)`)
	.option('-u, --user <email|id>', 'for a different user (support mode)')
	.action(async (key, value, options) => {
		if (options.debug) process.env.DEBUG = ourDEBUG
		const args = [options.user || 'me', key, value].filter(optional => !!optional)
		await asyncChild(process, resolveScript('developer-features.js'), ...args)
	})

commander.command('export-data').alias('ed')
	.description(chalk.yellow('exfiltrate all messages from your spaces to disk in a structured data format (JSON)'))
	.option('-d, --debug', `with DEBUG=${ourDEBUG} (verbose mode)`)
	.action(async (options) => {
		if (options.debug) process.env.DEBUG = ourDEBUG
		await asyncChild(process, resolveScript('export-data.js'))
	})

commander.command('guest-credentials <issuer> <secret> [email]').alias('gc')
	.description(chalk.yellow('compose a JWT token using Persistent Guest credentials and send a message to yourself'))
	.option('-d, --debug', `with DEBUG=${ourDEBUG} (verbose mode)`)
	.action(async (issuer, secret, email, options) => {
		if (options.debug) process.env.DEBUG = ourDEBUG
		await asyncChild(process, resolveScript('guest-credentials.js'), issuer, secret, email)
	})

const guestDEBUG = oldDEBUG ? `${oldDEBUG},guest:*` : 'guest:*'
const guestURL = 'https://www.npmjs.com/package/sparkguest'
commander.command('spark-guest [args...]').alias('guest')
	.description(chalk.red(`interact with Persistent Guest features (see: ${guestURL})`))
	.option('-d, --debug', `with DEBUG=${guestDEBUG} (verbose mode)`)
	.action(async (args, options) => {
		if (options.debug) process.env.DEBUG = guestDEBUG
		await asyncChild(process, resolveScript('..', 'node_modules', '.bin', 'sparkguest'), ...args)
	})

commander.command('onboard-teams [roster-files...]').alias('ot')
	.description(chalk.blue('add participants to (new or) existing teams in bulk, using rosters (lists of email addresses)'))
	.option('-d, --debug', `with DEBUG=${ourDEBUG} (verbose mode)`)
	.option('-n, --dry-run', 'only print actions (skip all write operations)')
	.option('-y, --no-interactive', 'default all options (skip all interactive prompts)')
	.action(async (args, options) => {
		if (options.debug) process.env.DEBUG = ourDEBUG
		if (options.dryRun) process.env.DRY_RUN = 'true' // skip write operations
		if (!options.interactive) process.env.NO_PROMPTS = 'true' // skip inquirer
		await asyncChild(process, resolveScript('onboard-teams.js'), ...args)
	})

commander.command('roster-memberships').alias('rm')
	.description(chalk.yellow('clone an existing space (copy memberships, no content/messages) to roster file, or elsewhere'))
	.option('-d, --debug', `with DEBUG=${ourDEBUG} (verbose mode)`)
	.action(async (options) => {
		if (options.debug) process.env.DEBUG = ourDEBUG
		await asyncChild(process, resolveScript('roster-memberships.js'))
	})

commander.command('webhook-tools [args...]').alias('wt')
	.description(chalk.yellow('check (santity test) existing webhooks (also provides easy create/delete and list mechanisms)'))
	.option('-d, --debug', `with DEBUG=${ourDEBUG} (verbose mode)`)
	.action(async (args, options) => {
		if (options.debug) process.env.DEBUG = ourDEBUG
		await asyncChild(process, resolveScript('webhook-tools.js'), ...args)
	})

commander.command('tutorial [args...]').alias('tour')
	.description(chalk.green(`if you're new to ${packageJSON.name} (or want to learn more) get started here! (alias: tour)`))
	.option('-d, --debug', `with DEBUG=${ourDEBUG} (verbose mode)`)
	.option('-f, --force', 'ignore any secret(s) known beforehand')
	.action(async (args, options) => {
		if (options.debug) process.env.DEBUG = ourDEBUG
		if (options.force) process.env.CISCOSPARK_ACCESS_TOKEN = ''
		// args might specify specific tutorials, or set(s) of tutorials
		await asyncChild(process, resolveScript('tutorial.js'), args)
	})

if (process.env.NODE_ENV === 'test') {
	commander.command('test-empty-function')
		.action(() => {
		})
	commander.command('test-empty-async')
		.action(async () => {
		})
	commander.command('test-script-failure')
		.action(async () => {
			await asyncChild(process, resolveScript('test-failure.js'))
		})
	commander.command('test-script-missing')
		.action(async () => {
			await asyncChild(process)
		})
	commander.command('test-script-success')
		.action(async () => {
			await asyncChild(process, resolveScript('test-success.js'))
		})
	commander.command('test-reject-async')
		.action(async () => {
			throw new Error('from inside async action handler')
		})
	commander.command('test-throw-error')
		.action(() => {
			throw new Error('from inside action handler')
		})
}

module.exports = commander

if (!module.parent) {
	/* eslint-disable no-console */
	const examples = Object.freeze({
		'cwt df | jq \'map({(.key):.val}) | add\'': 'obtain a JSON summary of your feature flags',
	})
	const example = (r = Math.random()) => {
		const keys = Object.keys(examples)
		const index = Math.floor(r * keys.length)
		return [keys[index], examples[keys[index]]]
	}
	commander.on('--help', () => {
		const [command, english] = example() // choose a random "try me" script; TODO (tohagema): add more examples above
		const [external, beta, unstable] = [chalk.red('red'), chalk.yellow('yellow'), chalk.bold('new additions or in beta')]
		console.error()
		console.error(`\tScripts in ${beta} are ${unstable}. (${external} means the script is provided via an external package)`)
		console.error()
		console.error(chalk.blue('\tPROTIP: use `cwt` with `jq` and short script aliases to get answers quickly! For example:'))
		console.error()
		console.error(`\t${chalk.green(command)} # ${english}`)
		console.error()
		console.error(chalk.blue('\tN.B. Adding --debug (or -d) to any command will help diagnose issues with scripts.'))
		console.error()
	})
	asyncParent(process)
		.then(async ({ newerVersion, parseCommands, setupSecrets }) => {
			// this method for determination of a command being run is sometimes unreliable:
			if (parseCommands.args.every(one => typeof one === 'string')) {
				if (newerVersion instanceof Error) {
					console.error(chalk.red(`\n\tFailed to check for new version (${newerVersion.message})`))
				} else if (newerVersion && semver.lt(packageJSON.version, newerVersion)) {
					console.error(`\n\tN.B. an update for ${packageJSON.name} is available (${newerVersion})`)
				}
				if (setupSecrets instanceof Error) {
					console.error(chalk.red(`\n\tFailed to load/check access token (${setupSecrets.message})`))
				}
				await asyncChild(process, __filename, ['--help']) // N.B. output from child will be printed last, always
			}
		})
		.catch((error) => {
			console.error()
			console.error(Object.assign(error, { message: chalk.red(error.message || 'no error message provided') }))
			console.error()
			console.error(chalk.yellow(`\tError message(s) above may be due to bugs in the npm package: ${packageJSON.name}`))
			console.error()
			console.error(chalk.yellow('\tIf so, please file a GitHub issue (with full reproduction steps) here:'))
			console.error()
			console.error(chalk.yellow(`\t${packageJSON.bugs.url}`))
			console.error()
			process.exitCode = 1
		})
}
