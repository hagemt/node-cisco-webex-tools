const childProcess = require('child_process')
const path = require('path')

const commander = require('commander')
const _ = require('lodash')

const packageJSON = require('../package.json')
const log = require('../support/log.js')

const supportedScripts = Object.freeze({
	'onboard-teams': 'create a new Team from an email roster',
})

const getCommander = () => {
	const versionString = packageJSON.version || '0.0.0'
	return commander.version(versionString, '-v, --version')
}

module.exports = {
	getCommander,
}

if (!module.parent) {
	const [scriptName, ...args] = process.argv.slice(2)
	log.debug('script %s: %s', scriptName, args.join(' '))
	if (scriptName in supportedScripts) {
		const modulePath = path.resolve(__dirname, `${scriptName}.js`)
		const child = childProcess.fork(modulePath, args, {
			cwd: process.cwd(),
			env: process.env,
			stdio: 'inherit',
		})
		child.on('exit', (code, signal) => {
			if (signal) process.exitCode = 1
			else process.exitCode = code
		})
	} else {
		/* eslint-disable no-console */
		console.log(`${_.size(supportedScripts)} script(s) supported:`)
		for (const [key, value] of Object.entries(supportedScripts)) {
			console.log(`\t* ${key}: ${value}`)
		}
		console.log()
		console.log('to run a script:')
		console.log('\t$ npm run script -- script-name ...arguments')
	}
}
