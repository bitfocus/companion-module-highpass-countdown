module.exports = {
	extraFiles: ['public/*', 'node_modules/socket.io/client-dist/socket.io.min.js'],
	webpack: {
		node: {
			__dirname: true,
		},
	},
} 