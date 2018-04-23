const http = require('http')

const _ = require('lodash')

const log = require('./log.js')

class ClientError extends Error {

	static async fromResponse (response) {
		const statusMessage = ClientError.statusMessage(response)
		const body = await response.json().catch(() => null)
		const details = _.get(body, 'message', statusMessage)
		const tracking = _.get(body, 'trackingId', 'missing')
		const message = `(tracking ID: ${tracking}) ${details}`
		log.debug('ClientError#fromResponse: %s', message) // too much?
		return Object.assign(new ClientError(message), { body, response })
	}

	static async retryAfter (header, retry) {
		const seconds = Number(header) || 0 // default: no wait
		log.debug('Scheduled retry after: %s (seconds)', seconds)
		await new Promise(done => setTimeout(done, seconds * 1000))
		return retry()
	}

	static statusMessage ({ status }) {
		return _.get(http.STATUS_CODES, status, 'Unknown')
	}

}

module.exports = ClientError
