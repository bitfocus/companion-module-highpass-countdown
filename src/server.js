import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function setupWebServer(instance) {
	const app = express()
	const server = http.createServer(app)
	const io = new Server(server, {
		cors: {
			origin: '*',
		},
	})

	const isDev = __dirname.endsWith('src')

	if (isDev) {
		// In development, serve the public folder and socket.io from node_modules
		app.use(express.static(path.join(__dirname, '../public')))
		app.get('/socket.io.min.js', (req, res) => {
			res.sendFile(path.join(__dirname, '../node_modules/socket.io/client-dist/socket.io.min.js'))
		})
	} else {
		// In production, all files are in the same directory
		app.use(express.static(__dirname))
	}

	io.on('connection', (socket) => {
		instance.log('debug', 'Client connected to web server')

		// Send initial state
		socket.emit('state', instance.getFullState())

		socket.on('disconnect', () => {
			instance.log('debug', 'Client disconnected from web server')
		})

		instance.broadcastState()
	})

	const port = instance.config.port || 8080
	server.listen(port, () => {
		instance.log('info', `Web server started on port ${port}`)
	})

	return {
		server,
		io,
	}
} 