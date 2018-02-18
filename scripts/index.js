#!/usr/bin/env node
const { fork } = require('child_process')
const path = require('path')

const chalk = require('chalk')
const ciscospark = require('commander')

const packageJSON = require('../package.json') // for version, etc.
const modulePath = (...args) => path.resolve(__dirname, ...args)

const [COMMAND_PROCESS, SHARED_ENV] = [process, process.env]
const [EXIT_SUCCESS, EXIT_FAILURE] = [0, 1] // not always correct?

const forkProcess = (scriptName, ...args) => {
	const options = {
		cwd: process.cwd(),
		env: SHARED_ENV,
		stdio: 'inherit',
	}
	return fork(modulePath(scriptName), args, options)
}

const asyncParse = async (parentProcess = COMMAND_PROCESS) => {
	// should run update check automatically?
	// (make sure it's always non-invasive)
	parentProcess.exitCode = EXIT_SUCCESS
	ciscospark.parse(parentProcess.argv)
	if (parentProcess.argv.length === 2) {
		ciscospark.help()
	}
	return new Promise((resolve, reject) => {
		parentProcess.once('exit', () => {
			if (parentProcess.exitCode === EXIT_SUCCESS) resolve(parentProcess)
			else reject(new Error(chalk.red('Script did not complete normally!')))
		})
	})
}

const asyncChild = async (createChild, parentProcess = COMMAND_PROCESS) => {
	try {
		const childProcess = await createChild()
		childProcess.once('exit', (code, signal) => {
			if (signal) parentProcess.exitCode = EXIT_FAILURE
			else parentProcess.exitCode = code // from child
		})
		return childProcess
	} catch (error) {
		parentProcess.exitCode = EXIT_FAILURE
	}
}

ciscospark._name = chalk.bold(packageJSON.name || 'ciscospark-tools')
ciscospark.version(packageJSON.version || 'unknown', '-v, --version')

/*
ciscospark.command(chalk.bold('developer-features') + ' [key] [value]')
	.description(chalk.blue('list/get/set which functionality your user has toggled (enabled/disabled)'))
	.option('-d, --debug', chalk.blue('run toggle with DEBUG=ciscospark-tools (verbose mode)'))
	.action((key, value, options) => {
		if (options.debug) SHARED_ENV.DEBUG = 'ciscospark-tools' // verbose mode
		asyncChild(() => forkProcess('developer-features.js', key, value))
	})
*/

ciscospark.command(chalk.bold('onboard-teams') + ' [email-rosters...]')
	.description(chalk.blue('add participants to (new or) existing teams in bulk, using email rosters'))
	.option('-d, --debug', chalk.blue('run onboarding with DEBUG=ciscospark-tools (verbose mode)'))
	.option('-n, --dry-run', chalk.blue('skip actual team manipulation; instead, print email rosters'))
	.option('-s, --no-interactive', chalk.blue('skip all prompts (for which team, team names, etc.)'))
	.action((args, options) => {
		if (!options.interactive) SHARED_ENV.NO_PROMPTS = 'true' // no inquirer
		if (options.debug) SHARED_ENV.DEBUG = 'ciscospark-tools' // verbose mode
		if (options.dryRun) SHARED_ENV.DRY_RUN = 'true' // no write operations
		asyncChild(() => forkProcess('onboard-teams.js', ...args))
	})

/*
ciscospark.command(chalk.bold('tutorial'))
	.alias('help')
	.description(chalk.green('if you\'re new to ciscospark-tools (or want to learn more) get started here!'))
	.action(() => {
		// tutorial should take no options; keep it simple
		asyncChild(() => forkProcess('meta-tutorial.js'))
	})
*/

/*
ciscospark.command(chalk.bold('update'))
	.description(chalk.blue(`run this command (or use: npm -g update ${packageJSON.name}) to update ${packageJSON.name}`))
	.option('-d, --debug', chalk.blue('run check/update with DEBUG=ciscospark-tools (verbose mode)'))
	.option('-n, --check', chalk.blue('skip actual update, only check for available updates'))
	.option('-y, --yes', chalk.blue('answer all prompts for confirmation in the affirmative'))
	.action((options) => {
		if (options.check) SHARED_ENV.DRY_RUN = 'true'
		if (options.debug) SHARED_ENV.DEBUG = 'ciscospark-tools'
		if (options.yes) SHARED_ENV.NO_PROMPTS = 'true'
		asyncChild(() => forkProcess('meta-update.js'))
	})
*/

module.exports = ciscospark

if (!module.parent) {
	asyncParse()
		.catch((error) => {
			/* eslint-disable no-console */
			console.error(error)
			console.error()
			console.error(chalk.yellow('\tError messages above may be due to bugs in the npm package `ciscospark-tools`'))
			console.error()
			console.error(chalk.yellow('\tIf so, please file a GitHub issue (with full reproduction steps) here:'))
			console.error()
			console.error(chalk.yellow(`\t${packageJSON.bugs.url}`))
		})
}
