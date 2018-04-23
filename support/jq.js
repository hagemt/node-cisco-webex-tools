const cp = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const fetch = require('node-fetch')

const JQ_EXE_PATH = path.resolve(__dirname, `jq${os.platform() === 'win32' ? '.exe' : ''}`)
const JQ_URL_PREFIX = 'https://github.com/stedolan/jq/releases/download/jq-1.5' // or w/e

const supported = Object.freeze({
	'darwin+x64': 'jq-osx-amd64',
	'linux+x32': 'jq-linux32',
	'linux+x64': 'jq-linux64',
	'win32+x32': 'jq-win32.exe',
	'win32+x64': 'jq-win64.exe',
})

const getJQ = async () => {
	const jqEXE = supported[`${os.platform()}+${os.arch()}`]
	if (!jqEXE) {
		throw new Error(`not supported: ${os.release()}`)
	}
	const jqURL = `${JQ_URL_PREFIX}/${jqEXE}`
	const response = await fetch(jqURL)
	if (!response.ok) {
		throw new Error(`fetch failed: GET ${jqURL}`)
	}
	await new Promise((resolve, reject) => {
		const output = fs.createWriteStream(JQ_EXE_PATH)
		output.once('finish', resolve)
		output.once('error', reject)
		response.body.once('error', reject)
		response.body.pipe(output)
	})
	fs.chmodSync(JQ_EXE_PATH, 0o777)
}

const hasJQ = async () => {
	try {
		return fs.statSync(JQ_EXE_PATH).isFile()
	} catch (error) {
		return false
	}
}

const runJQ = async (...args) => {
	if (!await hasJQ()) await getJQ()
	return cp.spawnSync(JQ_EXE_PATH, ...args)
}

module.exports = {
	getJQ,
	hasJQ,
	runJQ,
}

if (!module.parent) {
	/* eslint-disable no-console */
	const args = process.argv.slice(2)
	const options = {
		env: process.env,
	}
	runJQ(args, options)
		.catch((error) => {
			console.error(error)
			process.exitCode = 1
		})
}
