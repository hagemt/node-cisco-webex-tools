const http = require('http')

const _ = require('lodash')

const log = require('./log.js')

class SparkError extends Error {

	static async fromResponse (response) {
		const statusMessage = SparkError.statusMessage(response)
		const body = await response.json().catch(() => null)
		const details = _.get(body, 'message', statusMessage)
		const tracking = _.get(body, 'trackingId', 'missing')
		const message = `Status ${response.status}: ${details} (tracking ID: ${tracking})`
		log.debug('Error from Spark; %s', message) // in case it gets swallowed
		return Object.assign(new SparkError(message), { body, response })
	}

	static async retryAfter (header, retry) {
		const seconds = Number(header) || 0 // default: no wait
		log.debug('Request retry after: %s (seconds)', seconds)
		await new Promise(done => setTimeout(done, seconds * 1000))
		return retry()
	}

	static statusMessage ({ status }) {
		return _.get(http.STATUS_CODES, status, 'Unknown')
	}

}

module.exports = SparkError
