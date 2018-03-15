const fs = require('fs')
const os = require('os')
const path = require('path')

const chalk = require('chalk')
//const fetch = require('node-fetch')
const inquirer = require('inquirer')
const ProgressBar = require('progress')
const _ = require('lodash')

const log = require('../support/log.js')
const PACKAGE_JSON = require('../package.json')
const SparkTools = require('../support/SparkTools.js')

const clampNumber = (any, min, max, identity = 1) => Math.min(Math.max(min, Number(any) || identity), max)
const inquirerSeparator = (...args) => new inquirer.Separator(...args) // horizontal rule for choices:Array(s)
const spaceChoice = ({ created, title, type }) => `${type}: ${title} (created: ${created})` // no base64/UUID?

const stringifyJSON = (value, replacer = null, space = '\t') => JSON.stringify(value, replacer, space)
const writeFileSlow = (filename, ...args) => fs.writeFileSync(filename, stringifyJSON(...args) + os.EOL)

const DEFAULT_HOME = path.resolve(os.homedir(), `.${PACKAGE_JSON.name}`) // as populated by tutorial script
const defaultPath = (when = new Date()) => `dump-${when.toISOString().replace(/[-:.]/g, '_')}` // safe, unique

const whichDirectoryMessage = (home = DEFAULT_HOME) => `Create which directory, relative to ${home}?`
const whichSpacesMessage = () => 'Which spaces? (use spacebar to toggle; select none to dump only DMs)'

/*
const saveFileContent = async (filename, url, options) => {
	const response = await fetch(url, options) // may throw
	// not all files have a content type/disposition, or similar
	const contentType = response.headers.get('content-type') || ''
	const ext = contentType.slice(contentType.lastIndexOf('/') + 1)
	if (!response.ok) throw new Error(await response.text())
	await new Promise((resolve, reject) => {
		const resolvedPath = `${filename}.${ext || 'data'}`
		response.body.pipe(fs.createWriteStream(resolvedPath))
			.once('end', resolve) // good result: will complete
			.once('error', reject) // bad result: will throw
	})
}
*/

const inquireDataExport = async (tools, CST_HOME) => {
	const askWhichDirectory = Object.freeze({
		default: defaultPath(), // relative to:
		message: whichDirectoryMessage(CST_HOME),
		name: 'askWhichDirectory',
	})
	const listPageSize = Math.floor(clampNumber(process.stdout.rows / 2, 1, 100, 10))
	const allSpaces = await tools.listSpaces() // being unable to list spaces = total failure?
	const whichSpacesChoices = [inquirerSeparator()].concat(Array.from(allSpaces, spaceChoice).sort())
	const askWhichSpaces = Object.freeze({
		choices: whichSpacesChoices,
		message: whichSpacesMessage(),
		name: 'askWhichSpaces',
		pageSize: listPageSize,
		type: 'checkbox',
		when: allSpaces.length > 0,
	})
	const questions = [askWhichDirectory, askWhichSpaces]
	const answers = await inquirer.prompt(questions)
	const picked = new Set(answers[askWhichSpaces.name]) // if empty, filters all:
	const pickedSpaces = allSpaces.filter(space => picked.has(spaceChoice(space)))
	const directSpaces = allSpaces.filter(space => space.type === 'direct')
	return {
		directory: path.resolve(CST_HOME, answers[askWhichDirectory.name]),
		spaces: pickedSpaces.length === 0 ? directSpaces : pickedSpaces,
	}
}

const setupDataDirectory = async (directory, me) => {
	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory, { mode: 0o700 })
	}
	if (!fs.lstatSync(directory).isDirectory()) {
		throw new Error(`not a directory: ${directory}`)
	}
	if (fs.readdirSync(directory).length > 0) {
		throw new Error(`not empty directory: ${directory}`)
	}
	const contacts = [] // TODO (tohagema): other membership of all DMs?
	const metadataPath = path.resolve(directory, 'metadata-people.json')
	writeFileSlow(metadataPath, { contacts, origin: me }) // people graph?
	// something doesn't work quite right with this download mechanism:
	//const avatarPath = path.resolve(directory, 'metadata-avatar')
	//if (me.avatar) await saveFileContent(avatarPath, me.avatar)
}

const writeSpacesData = async (tools, options) => {
	const format = _.get(options, 'format', 'json') // default format: json
	if (format !== 'json') throw new Error(`unsuported format: ${format}`)
	// need to figure out how to use format most effectively here:
	const pipe = async (all, writeStream) => new Promise((resolve, reject) => {
		const hrtime = process.hrtime()
		writeStream.once('error', (error) => {
			const elapsed = process.hrtime(hrtime)
			const elapsedMS = Number(elapsed[0] * 1e3 + elapsed[1] / 1e6).toFixed(3)
			const kbWritten = Number(writeStream.bytesWritten / 1024 || 0).toFixed(3)
			log.debug('export: write failure (wrote %d KB in %d ms)', kbWritten, elapsedMS)
			log.debug('export: write failure (error message: %s)', error.message)
			reject(error)
		})
		writeStream.once('finish', () => {
			const elapsed = process.hrtime(hrtime)
			const elapsedMS = Number(elapsed[0] * 1e3 + elapsed[1] / 1e6).toFixed(3)
			const kbWritten = Number(writeStream.bytesWritten / 1024 || 0).toFixed(3)
			log.debug('export: write success (wrote %d KB in %d ms)', kbWritten, elapsedMS)
			resolve(all.length)
		})
		// N.B. to render JSON is slow and will potentially OOM node:
		writeStream.write(stringifyJSON(all) + os.EOL, () => {
			// one write (line/row) per item is required at scale
			writeStream.end() // will emit 'finish' (see above)
		})
	})
	const spacesPath = path.resolve(options.directory, 'metadata-spaces.json')
	writeFileSlow(spacesPath, options.spaces) // Array might be (too) large?
	const barFormat = '\texporting data [:bar] :percent done'
	const bar = new ProgressBar(chalk.bold(barFormat), {
		total: Math.floor(clampNumber(options.spaces.length, 10, Infinity, 10)),
		width: Math.floor(clampNumber(process.stdout.columns / 2, 1, 100, 50)),
	})
	const tasksPromise = async ({ id }) => { // currently has two stages (streams)
		const membershipsTask = async () => {
			const membershipsArray = await tools.listMemberships(id) // TODO stream: true
			const membershipsPath = path.resolve(options.directory, `memberships-${id}.json`)
			const count = await pipe(membershipsArray, fs.createWriteStream(membershipsPath))
			log.debug('export: wrote %d fetched membership(s) from %s', count, id)
		}
		const messagesTask = async () => {
			const messagesArray = await tools.listMessages(id) // TODO stream: true
			const messagesPath = path.resolve(options.directory, `messages-${id}.json`)
			const count = await pipe(messagesArray, fs.createWriteStream(messagesPath))
			log.debug('export: wrote %d fetched message(s) from %s', count, id)
		}
		return Promise.all([membershipsTask(), messagesTask()])
			.catch(error => error) // will be logged, before tick
			.then((maybeError) => {
				if (maybeError instanceof Error) { // use bar.interrupt to notify?
					log.debug('export: task error (message: %s)', maybeError.message)
				}
				bar.tick()
			})
	}
	await Promise.all(options.spaces.map(tasksPromise))
	while (!bar.complete) bar.tick() // dumb flush hack
}

const executeDataExport = async (tools, options) => {
	const me = await tools.getPersonDetails('me')
	await setupDataDirectory(options.directory, me)
	// TODO (tohagema): fetch people? (contacts)
	//await writeContactsJSON(tools, options)
	// TODO (tohagema): dump events if possible?
	// also, team memberships, teams, webhooks?
	if (options.spaces.length > 0) {
		await writeSpacesData(tools, options)
	} else {
		log.debug('export: no space(s) provided')
	}
	// TODO (tohagema): use archiver to compress?
}

const automaticDataExport = async (token, CST_HOME = DEFAULT_HOME) => {
	const tools = SparkTools.fromAccessToken(token)
	return executeDataExport(tools, {
		directory: path.resolve(CST_HOME, defaultPath()),
		spaces: await tools.listSpaces(), // or, failure
	})
}

const interactiveDataExport = async (token, CST_HOME = DEFAULT_HOME) => {
	const tools = SparkTools.fromAccessToken(token) // from env
	const options = await inquireDataExport(tools, CST_HOME)
	const data = await executeDataExport(tools, options)
	// collect some metrics about the exported data?
	return data
}

module.exports = {
	automaticDataExport,
	interactiveDataExport,
}

if (!module.parent) {
	/* eslint-disable no-console */
	const { CISCOSPARK_ACCESS_TOKEN, CISCOSPARK_TOOLS_HOME, DEBUG } = Object(process.env)
	if (process.stdout.isTTY) {
		if (!DEBUG) {
			console.log()
			console.log('\tHeads-up: this script is currently beta-level quality and does some heavy lifting.')
			console.log()
			console.log('\tIf you are really sure you want to run it, add the -d flag to set DEBUG mode on.')
			console.log()
			process.exit() // eslint-disable-line no-process-exit
		}
		console.log()
		console.log('\tPlease wait... (fetching list of all spaces; this might take several seconds)')
		console.log()
		interactiveDataExport(CISCOSPARK_ACCESS_TOKEN, CISCOSPARK_TOOLS_HOME)
			.catch((error) => {
				console.error(error)
				process.exitCode = 1
			})
	} else {
		automaticDataExport(CISCOSPARK_ACCESS_TOKEN, CISCOSPARK_TOOLS_HOME)
			.catch((error) => {
				console.error(error)
				process.exitCode = 1
			})
	}
}
