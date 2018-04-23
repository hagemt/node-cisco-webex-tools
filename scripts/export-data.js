const fs = require('fs')
const os = require('os')
const path = require('path')

const chalk = require('chalk')
const DataLoader = require('dataloader')
const fetch = require('node-fetch')
const inquirer = require('inquirer')
const ProgressBar = require('progress')
const _ = require('lodash')

const log = require('../support/log.js')
const PACKAGE_JSON = require('../package.json')
const ClientTools = require('../support/ClientTools.js')

const clampNumber = (any, min, max, identity = 1) => Math.min(Math.max(min, Number(any) || identity), max)
const inquirerSeparator = (...args) => new inquirer.Separator(...args) // horizontal rule for choices:Array(s)
const spaceChoice = ({ created, title, type }) => `${type}: ${title} (created: ${created})` // no base64/UUID?

const stringifyJSON = (value, replacer = null, space = '\t') => JSON.stringify(value, replacer, space)
const writeFileSlow = (filename, ...args) => fs.writeFileSync(filename, stringifyJSON(...args) + os.EOL)

const DEFAULT_HOME = path.resolve(os.homedir(), `.${PACKAGE_JSON.name}`) // as populated by tutorial script
const defaultPath = (when = new Date()) => `dump-${when.toISOString().replace(/[-:.]/g, '_')}` // safe, unique

const whichDirectoryMessage = (home = DEFAULT_HOME) => `Create which directory (absolute path) OR relative to ${home}?`
const whichSpacesMessage = () => 'Which spaces? (use spacebar to toggle; select none to dump only DMs to/from contacts)'

const inquireDataExport = async (tools, CST_HOME) => {
	const formatDirectoryPath = (dir = '') => dir === '' ? dir : `${dir.trim()}/` // not fs root
	const tildePrefixReplacement = dir => dir.startsWith('~/') ? dir.replace('~', os.homedir()) : dir
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
	return {
		directory: path.resolve(CST_HOME, tildePrefixReplacement(formatDirectoryPath(answers[askWhichDirectory.name]))),
		spaces: pickedSpaces.length === 0 ? allSpaces.filter(space => space.type === 'direct') : pickedSpaces, // subset
	}
}

const saveFileContent = async (prefix, url, options) => {
	const formats = Object.freeze({
		gif: '.gif',
		jpeg: '.jpg',
		png: '.png',
	})
	const hrtime = process.hrtime()
	const response = await fetch(url, options) // no timeout?
	if (!response.ok) throw new Error(await response.text())
	await new Promise((resolve, reject) => {
		const contentType = response.headers.get('content-type') || ''
		const two = contentType.split(';').shift() || '' // both parts
		const one = two.slice(two.lastIndexOf('/') + 1) // just second
		const path = `${prefix}${formats[one] || '.dat'}` // timestamp?
		const stream = fs.createWriteStream(path) // will open on pipe?
		stream.once('error', (error) => {
			const elapsed = process.hrtime(hrtime)
			const kbWritten = Number(stream.bytesWritten / 1024 || 0).toFixed(3)
			const elapsedMS = Number(elapsed[0] * 1e3 + elapsed[1] / 1e6).toFixed(3)
			log.debug('export: write failure (wrote %d KB in %d ms)', kbWritten, elapsedMS)
			log.debug('export: write failure (error message: %s)', error.message)
			reject(error)
		})
		stream.once('finish', () => {
			const elapsed = process.hrtime(hrtime)
			const kbWritten = Number(stream.bytesWritten / 1024 || 0).toFixed(3)
			const elapsedMS = Number(elapsed[0] * 1e3 + elapsed[1] / 1e6).toFixed(3)
			log.debug('export: write success (wrote %d KB in %d ms)', kbWritten, elapsedMS)
			resolve()
		})
		response.body.pipe(stream)
	})
}

const createProgressBar = (format, total, width = process.stdout.columns / 2) => {
	return new ProgressBar(chalk.bold(format), {
		total: Math.floor(clampNumber(total, 10, Infinity, 10)),
		width: Math.floor(clampNumber(width, 1, 100, 50)),
	})
}

const setupDataDirectory = async (tools, { directory }) => {
	if (!fs.existsSync(directory)) {
		fs.mkdirSync(directory, { mode: 0o700 })
	}
	if (!fs.lstatSync(directory).isDirectory()) {
		throw new Error(`not a directory: ${directory}`)
	}
	if (fs.readdirSync(directory).length > 0) {
		throw new Error(`not empty directory: ${directory}`)
	}
	const BLACKLIST = new Set(['Empty Title', '[Deleted User]']) // these titles indicate anomalous users
	const WHITELIST = _.keyBy(await tools.listSpaces({ type: 'direct' }), 'id') // index of all DM spaces
	const allPersonDetails = async (batchSize = 40) => {
		const me = await tools.getPersonDetails('me') // source vertex (DM spaces induce an undirected graph of contacts)
		const memberships = await tools.listMemberships() // edge adjacency list (will load other participant in conversation)
		const [DMs, not] = _.partition(memberships, ({ roomId: id }) => id in WHITELIST && !BLACKLIST.has(WHITELIST[id].title))
		for (const { roomId: id } of not) {
			if (id in WHITELIST) { // this hit the blacklist:
				const memberships = await tools.listSpaceMemberships(id)
				const messages = await tools.listMessages({
					max: 10,
					page: false,
					roomId: id,
				})
				const anomaly = {
					memberships,
					messages,
					space: WHITELIST[id],
				}
				log.debug('anomaly: %s', JSON.stringify(anomaly, null, '\t'))
			}
		}
		const bar = createProgressBar(chalk.bold('\tbuilding graph [:bar] :percent done'), DMs.length)
		// https://github.com/facebook/dataloader#new-dataloaderbatchloadfn--options:
		const [maxBatchSize, batch, cache, cacheKeyFn, cacheMap] = [batchSize, false]
		// FIXME (tohagema): batch loading is not currently supported
		const metrics = { batches: 0, failure: 0, success: 0 }
		// transforms DM membership => person details
		const load = async ([membership]) => {
			try {
				const all = await tools.listSpaceMemberships(membership.roomId)
				const others = _.filter(all, one => !one.isMonitor && one.personId !== membership.personId)
				if (others.length !== 1) throw new Error(`${others.length}/${all.length} other people in DM space?`)
				const person = await tools.getPersonDetails(others[0].personId)
				metrics.success += 1
				return [person]
			} catch (error) {
				log.debug(error)
				metrics.failure += 1
				return [null]
			} finally {
				bar.tick() // stderr
				metrics.batches += 1
			}
		}
		log.debug('%d item(s) to process %s (via loader)', DMs.length, batch ? `in batches of ${maxBatchSize}` : 'individually')
		const all = await new DataLoader(load, { batch, cache, cacheKeyFn, cacheMap, maxBatchSize }).loadMany(DMs) // never throws
		log.debug('%d item(s): %d loaded (%d failure, %d success)', all.length, metrics.batches, metrics.failure, metrics.success)
		return [me].concat(_.filter(all, one => !!one)) // loader will have logged thrown error (but need to filter nulls here)
	}
	const [me, ...others] = await allPersonDetails() // not using GraphQL
	const metadataPath = path.resolve(directory, 'metadata-people.json')
	writeFileSlow(metadataPath, { contacts: others, origin: me })
	// N.B. ^ for large graphs, this operation may cause problems
	const avatarPath = path.resolve(directory, 'metadata-avatar')
	if (me.avatar) await saveFileContent(avatarPath, me.avatar)
}

const writeSpacesData = async (tools, options) => {
	const format = _.get(options, 'format', 'json') // default format: json
	if (format !== 'json') throw new Error(`unsuported format: ${format}`)
	// TODO (tohagema): need to figure out how to use format most effectively here:
	// TODO (tohagema): should stream lines to file? (instead of using single #write)
	const writeAll = async (target, source) => new Promise((resolve, reject) => {
		const hrtime = process.hrtime()
		const stream = fs.createWriteStream(target)
		stream.once('error', (error) => {
			const elapsed = process.hrtime(hrtime)
			const elapsedMS = Number(elapsed[0] * 1e3 + elapsed[1] / 1e6).toFixed(3)
			const kbWritten = Number(stream.bytesWritten / 1024 || 0).toFixed(3)
			log.debug('export: write failure (wrote %d KB in %d ms)', kbWritten, elapsedMS)
			log.debug('export: write failure (error message: %s)', error.message)
			reject(error)
		})
		stream.once('finish', () => {
			const elapsed = process.hrtime(hrtime)
			const elapsedMS = Number(elapsed[0] * 1e3 + elapsed[1] / 1e6).toFixed(3)
			const kbWritten = Number(stream.bytesWritten / 1024 || 0).toFixed(3)
			log.debug('export: write success (wrote %d KB in %d ms)', kbWritten, elapsedMS)
			resolve(source.length)
		})
		stream.write(stringifyJSON(source) + os.EOL, () => {
			// N.B. to write large JSON blobs is "slow" and may OOM process
			// one #write (line/row record) per item is required at scale
			stream.end() // will emit 'finish' event (see handler above)
		})
	})
	const spacesPath = path.resolve(options.directory, 'metadata-spaces.json')
	writeFileSlow(spacesPath, options.spaces) // this Array might be (too) large? how large is too large?
	const bar = createProgressBar(chalk.bold('\texporting data [:bar] :percent done'), options.spaces.length)
	// each task pair will mark (#tick) own progress:
	const completeTasks = async ({ id }) => {
		const membershipsTask = async () => {
			const membershipsPath = path.resolve(options.directory, `memberships-${id}.json`)
			const count = await writeAll(membershipsPath, await tools.listMemberships(id))
			log.debug('export: wrote %d fetched membership(s) from %s', count, id)
		}
		const messagesTask = async () => {
			const messagesPath = path.resolve(options.directory, `messages-${id}.json`)
			const count = await writeAll(messagesPath, await tools.listMessages(id))
			log.debug('export: wrote %d fetched message(s) from %s', count, id)
			// TODO (tohagema): need to download content, or separate script?
		}
		await Promise.all([membershipsTask(), messagesTask()])
			.catch(error => error) // will be logged before tick
			.then((maybeError) => {
				if (maybeError instanceof Error) { // use bar.interrupt to notify?
					log.debug('export: task error (message: %s)', maybeError.message)
				}
				bar.tick()
			})
	}
	await Promise.all(options.spaces.map(completeTasks))
	while (!bar.complete) bar.tick() // dumb "flush" hack
}

const executeDataExport = async (tools, options) => {
	//await tools.setDeveloperFeature('messages-api', false)
	if (!await setupDataDirectory(tools, options)) return
	// TODO (tohagema): dump events if possible?
	// also, team memberships, teams, webhooks?
	//await setupDataDirectory(tools, options)
	if (options.spaces.length > 0) {
		await writeSpacesData(tools, options)
	} else {
		log.debug('export: no space(s) provided')
	}
	// TODO (tohagema): use archiver to compress?
	// probably not by default, depending on options
}

const automaticDataExport = async (token, CST_HOME = DEFAULT_HOME) => {
	const tools = ClientTools.fromAccessToken(token)
	const data = await executeDataExport(tools, {
		directory: path.resolve(CST_HOME, defaultPath()),
		spaces: await tools.listSpaces(), // or, failure
	})
	// collect some anonymous metrics about the exported data?
	return data
}

const interactiveDataExport = async (token, CST_HOME = DEFAULT_HOME) => {
	const tools = ClientTools.fromAccessToken(token) // from env
	const options = await inquireDataExport(tools, CST_HOME)
	const data = await executeDataExport(tools, options)
	// collect some anonymous metrics about the exported data?
	return data
}

module.exports = {
	automaticDataExport,
	interactiveDataExport,
}

if (!module.parent) {
	/* eslint-disable no-console */
	const { CISCOSPARK_ACCESS_TOKEN, CISCOSPARK_TOOLS_HOME, DEBUG } = Object(process.env)
	if (!DEBUG) {
		console.error()
		console.error('\tHeads-up: this script is currently beta-level quality and does some heavy lifting.')
		console.error()
		console.error('\tIf you are really sure you want to run it, add the -d flag to set DEBUG mode on.')
		console.error()
		process.exit() // eslint-disable-line no-process-exit
	}
	if (process.stdout.isTTY) {
		console.error()
		console.error('\tPlease wait... (fetching list of all spaces; this might take several seconds)')
		console.error()
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
