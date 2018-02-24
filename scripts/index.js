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
	const DEFAULT_HOME = Path.resolve(OS.homedir(), `.${packageJSON.name}`)
	const { CISCOSPARK_ACCESS_TOKEN, CISCOSPARK_TOOLS_HOME } = Object(env)
	const PACKAGE_TOOLS_HOME = CISCOSPARK_TOOLS_HOME || DEFAULT_HOME
	const SECRETS_JSON_PATH = Path.resolve(PACKAGE_TOOLS_HOME, 'secrets.json')
	const setupSecrets = async () => {
		if (CISCOSPARK_ACCESS_TOKEN) return // will ignore secrets file
		const secrets = JSON.parse(FS.readFileSync(SECRETS_JSON_PATH))
		const token = secrets.authorization.access_token
		if (token) env.CISCOSPARK_ACCESS_TOKEN = token
		else throw new Error('missing access token')
	}
	// one non-invasive way to check for newer CST version:
	const newerVersion = async () => new Promise((resolve, reject) => {
		if (!(Math.random() < 0.1)) return resolve() // not true or false
		const timeoutError = new Error('check took too long for good UX')
		const timeout = setTimeout(reject, 1000, timeoutError) // one second
		const newer = ({ 'dist-tags': { latest } }) => (latest !== packageJSON.version)
		const clear = done => any => { clearTimeout(timeout); done(any) }
		npmPackage().then(newer).then(clear(resolve), clear(reject))
	})
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

ciscospark.command('developer-features [key] [value]')
	.description(chalk.blue('list/get/set which functionality your user has toggled (enabled/disabled)'))
	.option('-d, --debug', chalk.blue('run toggle with DEBUG=ciscospark-tools (verbose mode)'))
	.action(async (key, value, options) => {
		if (options.debug) process.env.DEBUG = 'ciscospark-tools' // verbose mode
		await asyncChild(process, resolveScript('developer-features.js'), key, value)
	})

ciscospark.command('onboard-teams [email-rosters...]')
	.description(chalk.blue('add participants to (new or) existing teams in bulk, using email rosters'))
	.option('-d, --debug', chalk.blue('run onboarding with DEBUG=ciscospark-tools (verbose mode)'))
	.option('-n, --dry-run', chalk.blue('skip actual team manipulation; instead, print email rosters'))
	.option('-y, --no-interactive', chalk.blue('skip all prompts (for which team, team names, etc.)'))
	.action(async (args, options) => {
		if (!options.interactive) process.env.NO_PROMPTS = 'true' // no inquirer
		if (options.debug) process.env.DEBUG = 'ciscospark-tools' // verbose mode
		if (options.dryRun) process.env.DRY_RUN = 'true' // no write operations
		await asyncChild(process, resolveScript('onboard-teams.js'), ...args)
	})

ciscospark.command('tutorial')
	.description(chalk.green('if you\'re new to ciscospark-tools (or want to learn more) get started here!'))
	.action(async (args) => {
		// one day, args might specify specific tutorial, or tutorial set
		// tutorial should not specify any options (keep it simple, folks)
		await asyncChild(process, resolveScript('meta-tutorial.js'), args)
	})

/*
ciscospark.command('update')
	.description(chalk.blue(`run this command (or use: npm -g update ${packageJSON.name}) to update ${packageJSON.name}`))
	.option('-d, --debug', chalk.blue('run check/update with DEBUG=ciscospark-tools (verbose mode)'))
	.option('-n, --dry-run', chalk.blue('skip actual update, only check for available updates'))
	.option('-y, --yes', chalk.blue('answer all prompts for confirmation in the affirmative'))
	.action(async (options) => {
		if (options.debug) process.env.DEBUG = 'ciscospark-tools'
		if (options.dryRun) process.env.DRY_RUN = 'true'
		if (options.yes) process.env.NO_PROMPTS = 'true'
		await asyncChild(process, resolveScript('meta-update.js'))
	})
*/

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
	/* eslint-disable no-console */
	asyncParent(process)
		.then((tasks) => {
			const all = tasks.parseCommands.args // Array, may have Command
			const noCommand = all.every(one => typeof one === 'string')
			// TODO (tohagema): use chalk to decorate text in callback?
			if (noCommand) ciscospark.outputHelp(text => text + '\n')
		})
		.catch((error) => {
			console.error()
			console.error(Object.assign(error, { message: chalk.red(error.message || 'no error message provided') }))
			console.error()
			console.error(chalk.yellow('\tError message(s) above may be due to bugs in the npm package `ciscospark-tools`'))
			console.error()
			console.error(chalk.yellow('\tIf so, please file a GitHub issue (with full reproduction steps) here:'))
			console.error()
			console.error(chalk.yellow(`\t${packageJSON.bugs.url}`))
			console.error()
			process.exitCode = 1
		})
}
