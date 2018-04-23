/* eslint-env mocha */
const assert = require('assert')

const { Response } = require('node-fetch')

const ClientError = require('../support/ClientError.js')

describe('ClientError', () => {

	describe('.fromResponse', () => {

		it('can parse response from fetch', async () => {
			const body = Object.freeze({
				message: 'useful details',
				trackingId: 'some slug',
			})
			const response = new Response(JSON.stringify(body), {
				status: 501,
			})
			return ClientError.fromResponse(response)
				.then((error) => {
					assert(error instanceof ClientError, 'ClientError returned')
					assert(error instanceof Error, 'ClientError extends Error')
					assert(error.message.includes(body.message), 'includes message')
					assert(error.message.includes(body.trackingId), 'includes tracking ID')
					assert.strictEqual(error.response, response, 'has response')
					assert.deepStrictEqual(error.body, body, 'has body')
				})
		})

	})

	describe('.retryAfter', () => {

		it('runs the provided callback as delayed', (done) => {
			ClientError.retryAfter(null, done)
		})

	})

})
