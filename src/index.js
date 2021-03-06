/* global WebSocket */
import EventEmitter from 'events'

const defer = function () {
	const deferred = {}
	deferred.promise = new Promise(function (resolve, reject) {
		deferred.resolve = resolve
		deferred.reject = reject
	})
	return deferred
}

export default class RohrpostClient extends EventEmitter {
	constructor (url, config) {
		super()
		const defaultConfig = {
			pingInterval: 5000,
			token: ''
		}
		this._config = Object.assign(defaultConfig, config)
		this._url = url
		this._subscriptions = {}
		this._createSocket()
	}

	close () {
		this._normalClose = true
		this._socket.close()
	}

	subscribe (group) {
		const {id, promise} = this._createRequest(group)
		const payload = {
			type: 'subscribe',
			id,
			auth_jwt: this._config.token,
			data: group
		}
		this._socket.send(JSON.stringify(payload))
		return promise
	}

	unsubscribe (group) { // glorious copypasta
		const {id, promise} = this._createRequest(group)
		const payload = {
			type: 'unsubscribe',
			id,
			auth_jwt: this._config.token,
			data: group
		}
		this._socket.send(JSON.stringify(payload))
		return promise
	}

	call (name, data) {
		const {id, promise} = this._createRequest()
		const payload = {
			type: name,
			id,
			data
		}
		this._socket.send(JSON.stringify(payload))
		return promise
	}

	// ===========================================================================
	// INTERNALS
	// ===========================================================================
	_createSocket () {
		this._socket = new WebSocket(this._url)
		this.socketState = 'connecting' // 'closed', 'open', 'connecting'
		this._pingState = {
			latestPong: 0,
		}
		this.normalClose = false
		this._socket.addEventListener('open', () => {
			this.emit('open')
			this.socketState = 'open'
			// start pinging
			this._ping(this._socket)
			this._resubscribe()
		})

		this._socket.addEventListener('close', (event) => {
			this.socketState = 'closed'
			this.emit('closed') // why past tense? because the socket is already closed and not currently closing
			if (!this._normalClose) {
				setTimeout(() => {
					this.emit('reconnecting')
					this._createSocket()
				}, 3000) // throttle reconnect
			}
		})

		this._socket.addEventListener('message', this._processMessage.bind(this))
		this._openRequests = {} // save deferred promises from requests waiting for reponse
		this._nextRequestIndex = 1 // autoincremented rohrpost message id
	}

	_ping (starterSocket) { // we need a ref to the socket to detect reconnects and stop the old ping loop
		const timestamp = Date.now()
		const payload = {
			type: 'ping',
			id: timestamp
		}
		this._socket.send(JSON.stringify(payload))
		this.emit('ping')
		setTimeout(() => {
			if (this._socket.readyState !== 1 || this._socket !== starterSocket) return // looping on old socket, abort
			if (timestamp > this._pingState.latestPong) // we received no pong after the last ping
				this._handlePingTimeout()
			else this._ping(starterSocket)
		}, this._config.pingInterval)
	}

	_handlePingTimeout () {
		this._socket.close()
		this.emit('closed')
	}

	_processMessage (rawMessage) {
		const message = JSON.parse(rawMessage.data)
		this.emit('message', message)
		if (message.error) {
			// this.emit('error', message.error)
			const req = this._popPendingRequest(message.id)
			if (req === null) return
			req.deferred.reject(message.error)
			return
		}

		const typeHandlers = {
			pong: this._handlePong.bind(this),
			subscribe: this._handleSubscribe.bind(this),
			unsubscribe: this._handleUnsubscribe.bind(this),
			'subscription-update': this._handlePublish.bind(this)
		}

		if (typeHandlers[message.type] === undefined) {
			this._handleGeneric(message)
		} else {
			typeHandlers[message.type](message)
		}
	}

	_handlePong (message) {
		this.emit('pong')
		this._pingState.latestPong = Date.now()
	}

	_resubscribe () {
		for (let args of Object.values(this._subscriptions)) {
			this.subscribe(args)
		}
	}

	_handleSubscribe (message) {
		const req = this._popPendingRequest(message.id)
		if (req === null) return // error already emitted in pop
		if (!this._subscriptions[message.data.group]) this._subscriptions[message.data.group] = req.args
		req.deferred.resolve(message.data)
	}

	_handleUnsubscribe (message) {
		const req = this._popPendingRequest(message.id)
		if (req === null) return // error already emitted in pop
		for (let [group, args] of Object.entries(this._subscriptions)) {
			if (args.type === req.args.type && args.id === req.args.id) { // this is perhaps a bit stupid
				delete this._subscriptions[group]
				break
			}
		}
		req.deferred.resolve(message.data)
	}

	_handlePublish (message) {
		this.emit(message.data.group, null, message.data)
	}

	_handleGeneric (message) {
		const req = this._popPendingRequest(message.id)
		if (req === null) return // error already emitted in pop
		req.deferred.resolve(message.data)
	}

	// request - response promise matching
	_createRequest (args) {
		const id = this._nextRequestIndex++
		const deferred = defer()
		this._openRequests[id] = {deferred, args}
		return {id, promise: deferred.promise}
	}

	_popPendingRequest (id) {
		const req = this._openRequests[id]
		if (!req) {
			this.emit('error', `no saved request with id: ${id}`)
		} else {
			this._openRequests[id] = undefined
			return req
		}
	}
}
