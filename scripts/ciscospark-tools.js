#!/usr/bin/env node
const ciscospark = require('commander')

const packageJSON = require('../package.json')

const scripts = require('./index.js')

const versionString = packageJSON.version || '0.0.0'
ciscospark.version(versionString, '-v, --version')

ciscospark.command('onboard-teams [email-rosters...]')
	.alias('ot')
	.description('add participants to (new or) existing teams in bulk, using email rosters')
	.option('-d, --debug', 'run onboarding with DEBUG=ciscospark-tools (verbose mode)')
	.option('-I, --no-interactive', 'skip all prompts (for teams, team names, etc.)')
	.option('-n, --dry-run', 'skip actual team manipulation; instead, print email rosters')
	.action((args, options) => {
		if (options.debug) process.env.DEBUG = 'ciscospark-tools'
		if (!options.interactive) process.env.NO_PROMPTS = 'true'
		if (options.dryRun) process.env.DRY_RUN = 'true'
		const child = scripts.forkProcess('onboard-teams', ...args)
		child.once('exit', (code, signal) => {
			if (signal) process.exitCode = 1
			else process.exitCode = code
		})
	})

module.exports = ciscospark

if (!module.parent) {
	try {
		ciscospark.parse(process.argv)
		if (process.argv.length === 2) {
			ciscospark.help()
		}
	} catch (error) {
		/* eslint-disable no-console */
		console.error(error)
		console.error()
		console.error('\tError messages above may be due to bugs in the npm package `ciscospark-tools`')
		console.error()
		console.error('\tIf so, please file a GitHub issue (with full reproduction steps) here:')
		console.error()
		console.error(`\t${packageJSON.bugs.url}`)
		console.error()
	}
}
