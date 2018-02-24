/* eslint-env node */
const assert = require('assert')

const failure = () => {
	assert(false, 'will always fail')
}

module.exports = failure

if (!module.parent) {
	failure()
}
