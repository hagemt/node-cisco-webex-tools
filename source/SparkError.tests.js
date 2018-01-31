/* eslint-env mocha */
const assert = require('assert')

//const fetch = require('node-fetch')

const SparkError = require('./SparkError.js')

describe('SparkError', () => {

	describe('fromResponse', () => {

		const mockResponse = async ({ json, status }) => {
			return Object.freeze({
				json: async () => json,
				status,
			})
		}

		it('can parse response from fetch', async () => {
			//const response = await fetch(...)
			const json = Object.freeze({
				message: 'useful details',
				trackingId: 'some slug',
			})
			const status = 501
			const response = await mockResponse({ json, status })
			return SparkError.fromResponse(response)
				.then((error) => {
					assert(error instanceof SparkError, 'SparkError returned')
					assert(error instanceof Error, 'SparkError extends Error')
					assert(error.message.includes(json.message), 'includes message')
					assert(error.message.includes(json.trackingId), 'includes tracking ID')
					assert(error.message.includes(status), 'includes status')
				})
		})

	})

	describe('retryAfter', () => {

		it('runs the provided callback as delayed', (done) => {
			SparkError.retryAfter('0', done)
		})

	})

})
