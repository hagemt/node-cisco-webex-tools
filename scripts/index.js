#!/usr/bin/env node
const ChildProcess = require('child_process')
const FS = require('fs')
const OS = require('os')
const Path = require('path')

const chalk = require('chalk')
const ciscospark = require('commander')
const fetchResponse = require('node-fetch')
const packageJSON = require('../package.json')

const npmPackage = async (packageName = packageJSON.name) => {
	const packageURL = `https://registry.npmjs.org/${packageName}`
	const response = await fetchResponse(packageURL) // may throw
	if (response.ok) return response.json() // has .dist-tags.latest
	else throw new Error(`failed to fetch JSON from GET ${packageURL}`)
}

const resolveScript = (...args) => Path.resolve(__dirname, ...args)
const defaultReason = new Error('Abnormal script termination!')
const unhandledRejections = new Map() // Promise => Error

// returns a ChildProcess instance (currently via .fork)
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

const asyncParent = async (parent, env = parent.env) => {
	const DEFAULT_CONFIG_PATH = Path.resolve(OS.homedir(), `.${packageJSON.name}`)
	const { CISCOSPARK_ACCESS_TOKEN, CISCOSPARK_TOOLS_HOME } = Object(env)
	const CISCOSPARK_CONFIG_PATH = CISCOSPARK_TOOLS_HOME || DEFAULT_CONFIG_PATH
	const SECRETS_JSON_PATH = Path.resolve(CISCOSPARK_CONFIG_PATH, 'secrets.json')
	// tutorial will save Authorization in ~/.${packageJSON.name}/secrets.json
	const setupSecrets = async (secretsPath = SECRETS_JSON_PATH) => {
		if (CISCOSPARK_ACCESS_TOKEN) return // will ignore any JSON
		const secrets = JSON.parse(FS.readFileSync(secretsPath))
		const token = secrets.authorization.access_token
		if (token) env.CISCOSPARK_ACCESS_TOKEN = token
		else throw new Error('missing access token')
	}
	// non-invasive, single-request method to check NPM for latest CST:
	const newerVersion = async (packageVersion = packageJSON.version) => {
		if (Math.random() < 0.90) return Promise.resolve() // usually no operation
		const newer = ({ 'dist-tags': { latest } }) => (latest !== packageVersion)
		return new Promise((resolve, reject) => { // otherwise, check NPM quickly:
			const timeout = setTimeout(reject, 1000, new Error('hit 1s timeout'))
			const clear = done => any => { clearTimeout(timeout); done(any) }
			npmPackage().then(newer).then(clear(resolve), clear(reject))
		})
	}
	parent.exitCode = 0 // explicit optimistic outcome(s)
	const tasks = {
		newerVersion: await newerVersion().catch(error => error),
		setupSecrets: await setupSecrets().catch(error => error),
	}
	return new Promise((resolve, reject) => {
		parent.once('beforeExit', () => {
			const [firstReason] = [...unhandledRejections.values()]
			if (parent.exitCode === 0 && !firstReason) resolve(tasks)
			else reject(firstReason || defaultReason) // will log
		})
		parent.on('rejectionHandled', (promise) => {
			unhandledRejections.delete(promise)
		})
		parent.on('unhandledRejection', (reason, promise) => {
			unhandledRejections.set(promise, reason)
		})
		tasks.parseCommands = ciscospark.parse(parent.argv)
	})
}

ciscospark._name = chalk.bold(packageJSON.name || 'ciscospark-tools')
ciscospark.version(packageJSON.version || 'unknown', '-v, --version')

ciscospark.command('developer-features [key] [value]').alias('df')
	.description(chalk.blue('list/get/set which functionality your user has toggled (enabled/disabled)'))
	.option('-d, --debug', chalk.blue(`run toggle(s) with DEBUG=${packageJSON.name} (verbose mode)`))
	.action(async (key, value, options) => {
		if (options.debug) process.env.DEBUG = packageJSON.name + '*' // more verbose
		await asyncChild(process, resolveScript('developer-features.js'), key, value)
	})

ciscospark.command('guest-credentials <issuer> <secret> [email]').alias('guest')
	.description(chalk.blue('Compose a JWT token using Persistent Guest credentials and send a message on Spark'))
	.option('-d, --debug', chalk.blue(`run guest with DEBUG=${packageJSON.name} (verbose mode)`))
	.action(async (issuer, secret, email, options) => {
		if (options.debug) process.env.DEBUG = packageJSON.name + '*' // more verbose
		await asyncChild(process, resolveScript('guest.js'), issuer, secret, email)
	})

ciscospark.command('onboard-teams [email-rosters...]').alias('ot')
	.description(chalk.blue('add participants to (new or) existing teams in bulk, using email rosters'))
	.option('-d, --debug', chalk.blue(`run onboarding with DEBUG=${packageJSON.name} (verbose mode)`))
	.option('-n, --dry-run', chalk.blue('skip actual team manipulation; instead, print email rosters'))
	.option('-y, --no-interactive', chalk.blue('skip all prompts (for which team, team names, etc.)'))
	.action(async (args, options) => {
		if (options.debug) process.env.DEBUG = packageJSON.name + '*' // more verbose
		if (options.dryRun) process.env.DRY_RUN = 'true' // skip all write operations
		if (!options.interactive) process.env.NO_PROMPTS = 'true' // skip inquirer
		await asyncChild(process, resolveScript('onboard-teams.js'), ...args)
	})

ciscospark.command('tutorial [args...]').alias('help')
	.description(chalk.green(`if you're new to ${packageJSON.name} (or want to learn more) get started here!`))
	.option('-d, --debug', chalk.blue(`run onboarding with DEBUG=${packageJSON.name} (verbose mode)`))
	.action(async (args, options) => {
		if (options.debug) process.env.DEBUG = packageJSON.name + '*'
		// args might specify specific tutorials, or set(s) of tutorials
		await asyncChild(process, resolveScript('meta-tutorial.js'), args)
		ciscospark.outputHelp() // will print before tutorial is complete
	})

if (process.env.NODE_ENV === 'test') {
	ciscospark.command('test-script-failure')
		.action(async () => {
			await asyncChild(process, resolveScript('meta-failure.js'))
		})
	ciscospark.command('test-script-success')
		.action(async () => {
			await asyncChild(process, resolveScript('meta-success.js'))
		})
	ciscospark.command('test-throw-error')
		.action(() => {
			throw new Error('from inside action handler')
		})
	ciscospark.command('test-reject-async')
		.action(async () => {
			throw new Error('from inside async action handler')
		})
}

module.exports = ciscospark

if (!module.parent) {
	asyncParent(process)
		.then(async (tasks) => {
			const all = tasks.parseCommands.args // may have Command(s)
			const noCommand = all.every(one => typeof one === 'string')
			if (noCommand) await asyncChild(process, __filename, ['tutorial'])
		})
		.catch((error) => {
			/* eslint-disable no-console */
			console.error()
			console.error(Object.assign(error, { message: chalk.red(error.message || 'no error message provided') }))
			console.error()
			console.error(chalk.yellow(`\tError message(s) above may be due to bugs in the npm package: ${packageJSON.name}`))
			console.error()
			console.error(chalk.yellow('\tIf so, please file a GitHub issue (with full reproduction steps) here:'))
			console.error()
			console.error(chalk.yellow(`\t${packageJSON.bugs.url}`))
			console.error()
			/* eslint-enable no-console */
			process.exitCode = 1
		})
}
