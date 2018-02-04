/* eslint-env mocha */
const assert = require('assert')

//const fetch = require('node-fetch')

const SparkError = require('./SparkError.js')

describe('SparkError', () => {

	describe('fromResponse', () => {

		const mockResponse = async ({ json: body, status = 501 }) => {
			const json = async () => body // once only?
			return Object.freeze({ json, status })
		}

		it('can parse response from fetch', async () => {
			const body =  Object.freeze({
				message: 'useful details',
				trackingId: 'some slug',
			})
			//const response = await fetch(...)
			const response = await mockResponse({
				json: body,
			})
			return SparkError.fromResponse(response)
				.then((error) => {
					assert(error instanceof SparkError, 'SparkError returned')
					assert(error instanceof Error, 'SparkError extends Error')
					assert(error.message.includes(body.message), 'includes message')
					assert(error.message.includes(body.trackingId), 'includes tracking ID')
					assert(error.message.includes(response.status), 'includes status')
					assert.strictEqual(error.response, response, 'has response')
					assert.strictEqual(error.body, body, 'has body')
				})
		})

	})

	describe('retryAfter', () => {

		it('runs the provided callback as delayed', (done) => {
			SparkError.retryAfter(null, done)
		})

	})

})
