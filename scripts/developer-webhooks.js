const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const url = require('url')

const debug = require('debug')
const chalk = require('chalk')
const commander = require('commander')
const fetch = require('node-fetch')
const inquirer = require('inquirer')
const ngrok = require('ngrok')
const parse = require('co-body')
const _ = require('lodash')

const PACKAGE_JSON = require('../package.json')
commander._name = path.basename(__filename).replace('.js', '')
commander.version(PACKAGE_JSON.version, '-v, --version')

// TODO: use support log
const log = Object.freeze({
	debug: debug(PACKAGE_JSON.name),
	// eslint-disable-next-line no-console
	stderr: (...args) => console.error(...args),
	// eslint-disable-next-line no-console
	stdout: (...args) => console.log(...args),
})

const { CISCOSPARK_ACCESS_TOKEN, CISCOSPARK_URL_ORIGIN, NGROK_API_URL, PORT, USER_AGENT } = Object(process.env)

const DEFAULT_ORIGIN = CISCOSPARK_URL_ORIGIN || 'https://api.ciscospark.com' // production
const buildURL = (string, origin = DEFAULT_ORIGIN) => new url.URL(string, origin).toString()
const DEFAULT_PATH = path.resolve(os.homedir(), `.${PACKAGE_JSON.name}`, 'secrets.json')

const DEFAULT_HTTP_SERVER_PORT = PORT || '8080' // for local test server
const DEFAULT_NGROK_API_URL = NGROK_API_URL || 'http://localhost:4040'

const DEFAULT_USER_AGENT_PREFIX = `${PACKAGE_JSON.name}/${PACKAGE_JSON.version} (+${PACKAGE_JSON.bugs.url})`
const DEFAULT_USER_AGENT_SUFFIX = `${process.release.name}/${process.version} ${process.platform}/${process.arch}`

const defaultUserAgent = USER_AGENT || `${DEFAULT_USER_AGENT_PREFIX} ${DEFAULT_USER_AGENT_SUFFIX}` // header:
const defaultHeaders = Object.freeze({ 'content-type': 'application/json', 'user-agent': defaultUserAgent })
const stringifyJSON = (value, replacer = null, space = '\t') => JSON.stringify(value, replacer, space)

const checkExistingWebhooks = async (url, options) => {
	const interactiveWebhookVisitor = async (question, webhooksArray, visitWebhook) => {
		if (!question || _.size(webhooksArray) < 1 || !visitWebhook || !process.stdin.isTTY) return []
		const index = _.keyBy(webhooksArray, webhook => `${webhook.name} (created: ${webhook.created})`)
		const questions = [{ choices: Object.keys(index), message: question, name: question, type: 'checkbox' }]
		const answers = await inquirer.prompt(questions) // => answers:Object { [question]: choices:Array }
		return Promise.all(Array.from(answers[question], chosen => visitWebhook(index[chosen])))
	}
	const partitionUnique = (all, how) => {
		const index = _.groupBy(all, how) // Object
		const [unique] = _.partition(all, one => index[how(one)].length === 1)
		return [unique, index]
	}
	const me = await fetchJSON('/v1/people/me', options)
	const { items: before } = await fetchJSON(url, options)
	// this funnel detects many common problems with webhooks, including these cases:
	// 1) any webhook(s) with a status other than active (generally safe to delete)
	// 2) any webhook(s) that are essentially identical (subset of fields equal)
	// 3) more than a single webhook with resource/event = all/all (firehose)
	// 4) webhooks that have the same name or same targetUrl/filter (target)
	// 5) any group(s) of webhooks with the same resource/event and target
	log.stderr(chalk.bold(`${me.displayName} has ${before.length} webhook(s) to check... (may prompt for clean-up)`))
	const targetString = ({ filter, targetUrl }) => filter ? `${targetUrl}?${filter}` : targetUrl // filter ~ querystring
	const sorted = Array.from(before).sort(({ created: left }, { created: right }) => new Date(right) - new Date(left))
	const [active, others] = _.partition(sorted, ({ status }) => status === 'active') // others status is 'disabled'
	const [hasAllAll, notAllAll] = _.partition(active, ({ event, resource }) => event === 'all' && resource === 'all')
	const [unique, index] = partitionUnique(notAllAll, any => `${any.resource}/${any.event}: ${targetString(any)}`)
	if (active.length >= 100 || others.length >= 1) {
		log.stderr(`WARNING: ${active.length}/${before.length} webhooks(s) are active (status)`)
		if (others.length >= 1) {
			log.stderr(`WARNING: ${others.length} webhooks(s) are not active (status):`, stringifyJSON(others))
		}
	}
	if (hasAllAll.length >= 2) {
		log.stderr(`WARNING: ${hasAllAll.length} webhooks(s) will always fire (all/all):`, stringifyJSON(hasAllAll))
	}
	for (const [key, values] of Object.entries(_.groupBy(unique, 'name'))) {
		if (values.length >= 2) {
			log.stderr(`WARNING: ${values.length} webhooks(s) have the same name (${key}):`, stringifyJSON(values))
		}
	}
	for (const [key, values] of Object.entries(_.groupBy(unique, targetString))) {
		if (values.length >= 2) {
			log.stderr(`WARNING: ${values.length} webhooks(s) have similar target (${key}):`, stringifyJSON(values))
		}
	}
	for (const values of Object.values(index)) {
		if (values.length >= 2) {
			log.stderr(`WARNING: ${values.length} webhook(s) are suspiciously similar:`, stringifyJSON(values))
		}
	}
	const question = 'Which webhook(s) should be deleted? (can be re-created later)'
	const deleted = await interactiveWebhookVisitor(question, sorted, async (webhook) => {
		try {
			await fetchJSON(`/v1/webhooks/${webhook.id}`, {
				headers: _.get(options, 'headers'),
				method: 'DELETE',
			})
			return webhook
		} catch (error) {
			log.stderr(error)
			return error
		}
	})
	const { items: after } = await fetchJSON(url, options)
	return { after, before, deleted }
}

const checkWebhookDelivery = async (listeningServer, sendMessage) => {
	const hrtime = (...args) => process.hrtime(...args) // https://nodejs.org/api/process.html#process_process_hrtime_time
	const toMS = ([seconds, nanoseconds]) => Number(seconds * 1e3 + nanoseconds / 1e6).toFixed() // => ms:String (integer)
	const printMetrics = ({ delivery, deliveryError, messageError, msSetup, msSend, msPost, zero }) => {
		log.debug('%s/%s/%s/%sms elapsed (test setup/send/post/total)', msSetup, msSend, msPost, toMS(hrtime(zero)))
		const errors = [_.get(deliveryError, 'message', 'no webhook Error'), _.get(messageError, 'message', 'no message Error')]
		if (!delivery) log.stderr(`no webhook delivery observed (waited ${toMS(hrtime(zero))}ms):`, stringifyJSON({ errors }))
		else log.stdout(`message triggered webhook (within ${Number(msPost - msSend).toFixed()}ms):`, stringifyJSON(delivery))
	}
	const timed = {
		zero: hrtime(),
	}
	try {
		//log.stdout('delivery start')
		timed.delivery = await listeningServer.json(async () => {
			timed.msSetup = toMS(hrtime(timed.zero))
			const send = hrtime() // discounts setup
			try {
				//log.stdout('sending message')
				timed.message = await sendMessage()
				//log.stdout('sent message', timed.message)
			} catch (error) {
				timed.messageError = error
				//log.stdout('send error', error)
			} finally {
				timed.msSend = toMS(hrtime(send))
				//log.stdout('send complete')
			}
		})
	} catch (error) {
		timed.deliveryError = error
		//log.stdout('delivery error')
	} finally {
		timed.msPost = toMS(hrtime(timed.zero))
		//log.stdout('delivery done')
		printMetrics(timed)
	}
}

const loadToken = async (SECRETS_PATH = DEFAULT_PATH) => {
	const parsed = JSON.parse(fs.readFileSync(SECRETS_PATH)) // may throw
	return _.get(parsed, 'authorization.access_token', CISCOSPARK_ACCESS_TOKEN)
}

const TIMEOUT = Number(process.env.TIMEOUT) || 1000 * 9 // < 10s
const listenHTTP = async (port = DEFAULT_HTTP_SERVER_PORT) => {
	const server = http.createServer() // no default request handler
	server.json = async thunk => new Promise((resolve, reject) => {
		const timeoutError = new Error(`no request within ${TIMEOUT}ms`)
		const timeout = setTimeout(reject, TIMEOUT, timeoutError)
		server.once('request', async (req, res) => {
			clearTimeout(timeout) // won't hit timeout
			const body = await parse.json(req).catch(reject)
			if (body) resolve({ body, headers: req.headers })
			else reject(new Error('failed to parse JSON'))
			res.end() // will send back 200 OK response
		})
		const trigger = async () => {
			try {
				await thunk()
			} catch (error) {
				reject(error)
			}
		}
		trigger()
	})
	server.start = async () => new Promise((resolve, reject) => {
		server.once('error', reject)
		server.once('listening', () => {
			resolve({ server })
		})
		server.listen(port)
	})
	server.stop = async () => new Promise((resolve, reject) => {
		server.close((closeError) => {
			if (closeError) reject(closeError)
			else resolve({ server })
		})
	})
	return server.start()
}

const loggingAction = (f, p = process) => {
	return async (...args) => {
		try {
			await f(...args)
		} catch (error) {
			if (p) p.exitCode = 1
			log.debug(error)
		}
	}
}

const fetchJSON = async (uri, options) => {
	const headers = _.get(options, 'headers') // for Authorization
	const request = Object.assign({ method: 'GET' }, options, {
		headers: Object.assign({}, defaultHeaders, headers),
		url: new url.URL(uri, DEFAULT_ORIGIN).toString(),
	})
	if (typeof request.body === 'object') {
		request.body = JSON.stringify(request.body)
	}
	const response = await fetch(request.url, Object.freeze(request))
	if (!response.ok) throw new Error(await response.text()) // not OK
	const body = response.status === 204 ? null : await response.json()
	/*
	if (request.method === 'POST' || request.method === 'DELETE') {
		log.debug('fetch %s %s: %j', request.method, request.url, body)
		// TODO (tohagema): use DEBUG=node-fetch for this information?
	}
	*/
	return body
}

const tunnelHTTP = async (port = DEFAULT_HTTP_SERVER_PORT, ms = TIMEOUT + 1000) => {
	try {
		const { tunnels } = await fetchJSON(buildURL('/api/tunnels', DEFAULT_NGROK_API_URL)) // if ngrok already running
		const { public_url } = Object(tunnels.find(({ config, proto }) => proto === 'https' && config.addr.endsWith(port)))
		if (!public_url) throw new Error(`no tunnel matches the local port requested (ngrok provides: ${tunnels.length})`)
		log.debug(buildURL('/inspect/http', DEFAULT_NGROK_API_URL))
		return public_url
	} catch (fetchError) {
		try {
			const url = await ngrok.connect({ addr: port, proto: 'http' })
			log.debug(`ngrok is listening on PORT=${port} for ${ms}ms`)
			setTimeout(() => ngrok.kill().catch(log.debug), ms)
			return url
		} catch (connectError) {
			const messages = `${fetchError.message}/${connectError.message}`
			throw new Error(`failed to find/create tunnel (${messages})`)
		}
	}
}

const randomBytes = (n = 48, buffer = Buffer.alloc(n), ...args) => crypto.randomFillSync(buffer, ...args).toString('base64')
const randomWord = (array, index = Math.floor(Math.random() * array.length), any) => _.get(array, index % array.length, any)

const { adjectives, nouns } = require('./docker-words.json') // for name
const randomWords = () => `${randomWord(adjectives)}-${randomWord(nouns)}`

/*

const querystring = require('querystring')

// FIXME (tohagema): client-side validation might be stupid
const WEBHOOK_RESOURCE_EVENT_FILTER_WHITELIST = new Map([
	['memberships:created', new Map()],
	['memberships:deleted', new Map()],
	['memberships:updated', new Map()],
	['messages:created', new Map()],
	['messages:deleted', new Map()],
	['rooms:created', new Map()],
	['rooms:updated', new Map()],
])

const FILTER_KEYS = new Set([].concat(Array.from(WEBHOOK_RESOURCE_EVENT_FILTER_WHITELIST, pair => [...pair[1].keys()])))
const validFilter = filter => typeof filter === 'undefined' || _.keys(querystring.parse(filter), key => FILTER_KEYS.has(key))
const validResourceEvent = (resource = '', event = '') => WEBHOOK_RESOURCE_EVENT_FILTER_WHITELIST.has(`${resource}:${event}`)
const validURL = (targetUrl = '') => String(targetUrl).startsWith('http') // could try to parse this URL (deeper validation)

const validateWebhook = ({ event, filter, name, resource, secret, targetUrl }) => {
	if (!name) throw new Error('name is required (human-friendly identifier)')
	if (!secret) throw new Error('secret is required (for HMAC signatures)')
	if (!validResourceEvent(resource, event) || validFilter(filter)) {
		throw new Error(`invalid resource, event, or filter (${resource}/${event}/${filter})`)
	}
	if (!validURL(targetUrl)) throw new Error('invalid URL (must start with http)')
	return Object.freeze({ event, filter, name, resource, secret, targetUrl })
}

*/

commander.command('list-webhooks').alias('lw')
	.description('start here! (all commands support the -h option, for --help)')
	.option('-a, --authorization <path>', 'to JSON file that contains access token')
	.action(loggingAction(async (options) => {
		const token = await loadToken(options.authorization)
		if (!token) throw new Error('missing CISCOSPARK_ACCESS_TOKEN')
		const headers = { 'authorization': `Bearer ${token}` }
		const me = await fetchJSON('/v1/people/me', { headers })
		const { items } = await fetchJSON('/v1/webhooks', { headers })
		if (items.length > 0) log.stdout(stringifyJSON({ webhooks: items }))
		else log.stderr(chalk.bold(`${me.displayName} has no webhooks (why not create some?)`))
	}))

const validateWebhook = any => any // no client-side validation, for now
commander.command('create-webhooks <targetURL> [filters...]').alias('cw')
	.description('one for each filter (default: one webhook, with no filter)')
	.option('-a, --authorization <path>', 'to JSON file that contains access token')
	.option('-e, --event <all|created|deleted|updated>', 'all = any event (default: all)')
	.option('-l, --label <string>', 'a human-friendly webhook name (default: random scientist)')
	.option('-r, --resource <all|memberships|messages|rooms>', 'all = any resource (default: all)')
	.option('-s, --secret <string>', 'for HMAC to authenticate deliveries (default: random base64)')
	.action(loggingAction(async (targetUrl, filters, options) => {
		const event = _.get(options, 'event', 'all')
		const name = _.get(options, 'label', randomWords())
		const resource = _.get(options, 'resource', 'all')
		const secret = _.get(options, 'secret', randomBytes())
		const token = await loadToken(_.get(options, 'authorization'))
		if (!token) throw new Error('missing CISCOSPARK_ACCESS_TOKEN')
		const headers = { 'authorization': `Bearer ${token}` }
		const me = await fetchJSON('/v1/people/me', { headers })
		const createWebhook = async (filter /* optional */) => {
			try {
				const webhook = validateWebhook({ event, filter, name, resource, secret, targetUrl })
				const created = await fetchJSON('/v1/webhooks', { body: webhook, headers, method: 'POST' })
				return created
			} catch (error) {
				return error
			}
		}
		const logErrors = (results) => {
			const [errors, webhooks] = _.partition(results, result => result instanceof Error)
			log.stdout(stringifyJSON({ created: webhooks }))
			if (errors.length > 0) {
				for (const error of errors) log.debug(`ERROR: ${error.message}`)
				const [failed, total] = [errors, results].map(array => array.length)
				log.debug('WARNING: failed to create %d/%d webhook(s)', failed, total)
			}
		}
		const filtersArray = filters && filters.length ? filters : [undefined] // no filter
		log.debug('will create %d webhooks(s) for %s...', filtersArray.length, me.displayName)
		logErrors(await Promise.all(filtersArray.map(createWebhook))) // will handle logging
	}))

commander.command('delete-webhooks').alias('dw')
	.description('inspect and remove duplicate webhooks (interactive wizard)')
	.option('-a, --authorization <path>', 'to JSON file that contains access token')
	.action(loggingAction(async (options) => {
		const token = await loadToken(options.authorization)
		if (!token) throw new Error('missing CISCOSPARK_ACCESS_TOKEN')
		const headers = { 'authorization': `Bearer ${token}` }
		const { deleted } = await checkExistingWebhooks('/v1/webhooks', { headers })
		if (deleted.length > 0) log.stdout(stringifyJSON({ deleted })) // print others?
	}))


commander.command('test-webhooks').alias('tw')
	.description('verify that a POST is triggered and delivered to this machine')
	.option('-a, --authorization <path>', 'to JSON file that contains access token')
	.option('-p, --port <number>', `default: ${DEFAULT_HTTP_SERVER_PORT} (most users cannot bind ports < 1024)`)
	.action(loggingAction(async (options) => {
		const token = await loadToken(options.authorization)
		if (!token) throw new Error('missing CISCOSPARK_ACCESS_TOKEN')
		const headers = { 'authorization': `Bearer ${token}` }
		headers.trackingid = `ME_TEST_WEBHOOK_${Date.now()}`
		const me = await fetchJSON('/v1/people/me', { headers })
		log.stderr()
		log.stderr(chalk.bold(`\tHold still! I'm sending a DM on behalf of ${me.displayName} to trigger webhook delivery...`))
		log.stderr()
		const port = _.get(options, 'port', DEFAULT_HTTP_SERVER_PORT)
		const { server } = await listenHTTP(port)
		const targetUrl = await tunnelHTTP(port)
		// this webhook will be deleted whether or not it's triggered
		const [event, name, resource, secret] = ['created', randomWords(), 'messages', randomBytes()]
		const filter = `personId=${me.id}&roomType=direct` // assumes user sends no concurrent DMs
		const webhook = Object.freeze({ event, filter, name, resource, secret, targetUrl })
		headers.trackingid = `CREATE_TEST_WEBHOOK_${Date.now()}`
		log.debug('will create webhook: %s', stringifyJSON({ body: webhook, headers, method: 'POST' }))
		const created = await fetchJSON('/v1/webhooks', { body: webhook, headers, method: 'POST' })
		log.debug('created test webhook: %s', stringifyJSON(created))
		try {
			await checkWebhookDelivery(server, async () => {
				headers.trackingid = `TRIGGER_TEST_WEBHOOK_${Date.now()}`
				const send = { toPersonEmail: 'test.webhooks@sparkbot.io', text: new Date().toISOString() }
				log.debug('send test message: %s', stringifyJSON({ body: send, headers, method: 'POST' }))
				const sent = await fetchJSON('/v1/messages', { body: send, headers, method: 'POST' })
				log.debug('sent test message: %s', stringifyJSON(sent))
				return sent
			})
		} finally {
			try {
				headers.trackingid = `DELETE_TEST_WEBHOOK_${Date.now()}`
				await fetchJSON(`/v1/webhooks/${created.id}`, { headers, method: 'DELETE' })
				log.debug('deleted test webhook: %s', stringifyJSON(created))
			} catch (error) {
				log.debug(error)
			}
			await server.stop()
		}
	}))

module.exports = commander

if (!module.parent) {
	if (!process.env.DEBUG || !process.stdin.isTTY) {
		log.stderr()
		log.stderr('\tRun this script with -d, --debug with interactivity for logging.')
		log.stderr()
		process.exit() // eslint-disable-line no-process-exit
	}
	try {
		const parsed = commander.parse(process.argv) // does this throw?
		const noCommand = parsed.args.every(one => typeof one === 'string')
		if (noCommand) commander.help() // to stderr? supports callback
	} catch (error) {
		error.message = chalk.red(error.message)
		log.stderr()
		log.stderr(error)
		log.stderr()
		log.stderr(chalk.yellow(`\tThe message above may be due to a bug in the npm package named ${PACKAGE_JSON.name}.`))
		log.stderr()
		log.stderr(chalk.yellow('\tIf relevant, please follow instructions to document fix/reproduction steps here:'))
		log.stderr()
		log.stderr(chalk.yellow(`\t${PACKAGE_JSON.bugs.url}`))
		log.stderr()
		process.exitCode = 1
	}
}
