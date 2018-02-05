const childProcess = require('child_process')
const path = require('path')

const _ = require('lodash')

const log = require('../support/log.js')

const forkProcess = (scriptName, ...args) => {
	const modulePath = path.resolve(__dirname, `${scriptName}.js`)
	const child = childProcess.fork(modulePath, args, {
		cwd: process.cwd(),
		env: process.env,
		stdio: 'inherit',
	})
	return child
}

const supportedScripts = Object.freeze({
	'onboard-teams': 'create a new Team from an email roster',
})

module.exports = {
	forkProcess,
}

if (!module.parent) {
	const [scriptName, ...args] = process.argv.slice(2)
	if (scriptName in supportedScripts) {
		log.debug('script %s: %s', scriptName, args.join(' '))
		const child = forkProcess(scriptName, ...args)
		child.once('exit', (code, signal) => {
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
