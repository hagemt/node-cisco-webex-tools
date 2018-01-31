const _ = require('lodash')
const fetch = require('node-fetch')

const log = require('./log.js')
const SparkError = require('./SparkError.js')

const BASE_URL = process.env.CISCOSPARK_BASE_URL || 'http://api.ciscospark.com'
const buildURL = (someURI, baseURL = BASE_URL) => `${baseURL}${someURI}`

const DEFAULT_HEADERS = Object.freeze({
	'Accept': 'application/json',
	'Content-Type': 'application/json',
})

class SparkTools {

	constructor (userAccessToken) {
		if (!userAccessToken || typeof userAccessToken !== 'string') {
			throw new TypeError('export CISCOSPARK_ACCESS_TOKEN=... # from dev.ciscospark.com')
		}
		this.json = async (uri, options) => {
			const requestURL = buildURL(uri)
			const Authorization = `Bearer ${userAccessToken}`
			const headers = Object.assign({ Authorization }, DEFAULT_HEADERS, options.headers)
			const request = Object.assign({ url: requestURL }, options, { headers })
			const response = await this.fetch(requestURL, request)
			switch (response.status) {
			case 200: // OK
			case 201: // Created
				return response.json()
			case 204: // No Content
				return
			case 401:
				throw new SparkError('access token is invalid (get a new one from dev.ciscospark.com)')
			case 429:
				if (!options.retry) {
					throw new SparkError('sent Too Many Requests (according to Spark) and will not retry')
				}
				return SparkError.retryAfter(response.get('retry-after'), () => this.json(uri, options))
			default:
				throw await SparkError.fromResponse(response).catch(error => error)
			}
		}
	}

	/* istanbul ignore next */
	async fetch (url, options) {
		const hrtime = process.hrtime()
		const response = await fetch(url, options)
		const [s, ns] = process.hrtime(hrtime)
		log.debug('%s %s => %s (in %ss)',
			options.method || 'fetch',
			url,
			response.status,
			Number(s + ns / 1e9).toFixed(3),
		)
		return response
	}

	async getPerson (person = 'me') {
		const id = _.get(person, 'id', person)
		return this.json(`/v1/people/${id}`, {
			method: 'GET',
		})
	}

	async createTeamWithMyself ({ name }) {
		log.debug('create team (name: %s)', name)
		return this.json('/v1/teams', {
			body: JSON.stringify({ name }),
			method: 'POST',
		})
	}

	async addPersonToTeam (personEmail, teamId, isModerator = false) {
		log.debug('add person (email: %s) to team (%s)', personEmail, teamId)
		return this.json('/v1/team/memberships', {
			body: JSON.stringify({ isModerator, personEmail, teamId }),
			method: 'POST',
		})
	}

}

module.exports = SparkTools
