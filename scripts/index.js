const childProcess = require('child_process')
const path = require('path')

const commander = require('commander')
const _ = require('lodash')

const packageJSON = require('../package.json')
const log = require('../source/log.js')

const supportedScripts = Object.freeze({
	'onboard-teams': 'create a new Team from an email roster',
})

const getCommander = () => {
	const versionString = packageJSON.version || '0.0.0'
	return commander.version(versionString, '-v, --version')
}

const runScript = (script, ...args) => {
	const modulePath = path.resolve(__dirname, `${script}.js`)
	const child = childProcess.fork(modulePath, args, {
		cwd: process.cwd(),
		env: process.env,
		stdio: 'inherit',
	})
	child.on('exit', (code, signal) => {
		if (signal) process.exitCode = 1
		else process.exitCode = code
	})
}

module.exports = {
	getCommander,
	runScript,
}

if (!module.parent) {
	const [scriptName, ...args] = process.argv.slice(2)
	log.debug('script %s:', scriptName, ...args)
	if (scriptName in supportedScripts) {
		runScript(scriptName, ...args)
	} else {
		/* eslint-disable no-console */
		console.log(`${_.size(supportedScripts)} script(s) supported:`)
		for (const [key, value] of Object.entries(supportedScripts)) {
			console.log(`\t* ${key}: ${value}`)
		}
		console.log()
		console.log('to run a script:')
		console.log('\t$ npm run script -- script-name')
	}
}
