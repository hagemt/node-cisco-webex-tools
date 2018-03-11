const fs = require('fs')
const os = require('os')
const path = require('path')

const chalk = require('chalk')
//const fetch = require('node-fetch')
const inquirer = require('inquirer')
const ProgressBar = require('progress')

const log = require('../support/log.js')
const PACKAGE_JSON = require('../package.json')
const SparkTools = require('../support/SparkTools.js')

const inquirerSeparator = (...args) => new inquirer.Separator(...args) // for choices:Array
const spaceChoice = ({ created, title, type }) => `${type}: ${title} (created: ${created})`
const formatObject = (any, ...args) => `${JSON.stringify(any, ...args)}${os.EOL}`
const clamp = (any, min, max) => Math.min(Math.max(min, Math.floor(any)), max)

const inquireDataExport = async (tools, CST_HOME) => {
	const askWhichDirectory = Object.freeze({
		default: `dump-${new Date().toISOString().replace(/[-:.]/g, '_')}`,
		message: `Create which directory, relative to ${CST_HOME}?`,
		name: 'askWhichDirectory', // property name in answers
	})
	const listPageSize = clamp(process.stdout.rows / 2, 10, 100)
	const allSpaces = await tools.listSpaces().catch(() => [])
	const allChoices = Array.from(allSpaces, spaceChoice).sort()
	const askWhichSpaces = Object.freeze({
		choices: [].concat(inquirerSeparator(), allChoices),
		message: 'Which spaces? (select none for all)',
		name: 'askWhichSpaces',
		pageSize: listPageSize,
		type: 'checkbox',
		when: allSpaces.length > 0,
	})
	const questions = [askWhichDirectory, askWhichSpaces]
	const answers = await inquirer.prompt(questions)
	const picked = new Set(answers[askWhichSpaces.name]) // if empty, filters all:
	const pickedSpaces = allSpaces.filter(space => picked.has(spaceChoice(space)))
	return {
		directory: path.resolve(CST_HOME, answers[askWhichDirectory.name]),
		spaces: pickedSpaces.length === 0 ? allSpaces : pickedSpaces,
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
	fs.writeFileSync(metadataPath, formatObject({ contacts, origin: me }))
	/*
	// something here is broken
	if (me.avatar) {
		const response = await fetch(me.avatar).catch(() => null)
		if (response && response.ok) {
			await new Promise((done) => {
				const avatarPath = path.resolve(directory, 'origin.avatar')
				const avatarStream = fs.createWriteStream(avatarPath)
				response.body.pipe(avatarStream).on('end', done)
			})
		}
	}
	*/
}

const writeSpacesData = async (tools, options) => {
	const spacesPath = path.resolve(options.directory, 'metadata-spaces.json')
	fs.writeFileSync(spacesPath, formatObject(options.spaces, null, '\t'))
	const barFormat = '\texporting data [:bar] :percent done'
	const bar = new ProgressBar(chalk.bold(barFormat), {
		total: clamp(options.spaces.length, 10, Infinity),
		width: clamp(process.stdout.columns / 2, 10, 100),
	})
	const taskPromise = async ({ id }) => { // currently has two stages (streams)
		const membershipsPath = path.resolve(options.directory, `memberships-${id}.json`)
		const membershipsStream = fs.createWriteStream(membershipsPath) // options?
		const membershipsTask = async () => {
			const memberships = await tools.listMemberships(id) // roomId
			log.debug('export: fetched %d membership(s)', memberships.length)
			for (const membership of memberships) {
				membershipsStream.write(formatObject(membership))
			}
		}
		const messagesPath = path.resolve(options.directory, `messages-${id}.json`)
		const messagesStream = fs.createWriteStream(messagesPath) // options?
		const messagesTask = async () => {
			const messages = await tools.listMessages(id) // roomId
			log.debug('export: fetched %d message(s)', messages.length)
			for (const message of messages) {
				messagesStream.write(formatObject(message))
			}
		}
		return Promise.all([membershipsTask(), messagesTask()])
			.catch(error => error) // will be logged, before tick
			.then((maybeError) => {
				if (maybeError instanceof Error) { // use bar.interrupt to notify?
					log.debug('export: task error (message: %s)', maybeError.message)
				}
				membershipsStream.end()
				messagesStream.end()
				bar.tick()
			})
	}
	await Promise.all(options.spaces.map(taskPromise))
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

const DEFAULT_HOME = path.resolve(os.homedir(), `.${PACKAGE_JSON.name}`)
const interactiveDataExport = async (token, CST_HOME = DEFAULT_HOME) => {
	const tools = SparkTools.fromAccessToken(token) // for list ops
	const options = await inquireDataExport(tools, CST_HOME)
	const data = await executeDataExport(tools, options)
	return data
}

module.exports = {
	interactiveDataExport,
}

if (!module.parent) {
	/* eslint-disable no-console */
	console.log()
	console.log('\tPlease wait... (fetching list of all spaces; this might take several seconds)')
	console.log()
	const { CISCOSPARK_ACCESS_TOKEN, CISCOSPARK_TOOLS_HOME } = Object(process.env)
	interactiveDataExport(CISCOSPARK_ACCESS_TOKEN, CISCOSPARK_TOOLS_HOME)
		.catch((error) => {
			console.error(error)
			process.exitCode = 1
		})
}
