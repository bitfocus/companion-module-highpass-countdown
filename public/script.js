const socket = io()

const timerEl = document.getElementById('timer')
const topAuxEl = document.getElementById('top-aux')
const bottomAuxEl = document.getElementById('bottom-aux')
const middleAuxEl = document.getElementById('middle-aux')
const internalTimeEl = document.getElementById('internal-time')
const speakButton = document.getElementById('speak-button')

// Speech synthesis setup
let speechSynth = null
let currentVoice = null
let speechConfig = {}

if ('speechSynthesis' in window) {
	speechSynth = window.speechSynthesis
	
	// Load voices when available
	const loadVoices = () => {
		const voices = speechSynth.getVoices()
		if (voices.length > 0) {
			// Prefer English voices, fallback to first available
			currentVoice = voices.find(voice => voice.lang.startsWith('en')) || voices[0]
		}
	}
	
	// Load voices immediately and on voiceschanged event
	loadVoices()
	speechSynth.onvoiceschanged = loadVoices
}

function formatTime(totalSeconds) {
	const sign = totalSeconds < 0 ? '-' : ''
	const seconds = Math.abs(totalSeconds)
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = seconds % 60
	return `${sign}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

// Speech synthesis function
function speak(text) {
	if (!speechSynth || !currentVoice || speechSynth.speaking) {
		return false
	}

	// Clean up text for speech
	const cleanText = text.replace(/(…|[._]{2,})/g, '').trim()
	if (!cleanText) return false

	const utterance = new SpeechSynthesisUtterance(cleanText)
	
	// Apply speech configuration
	utterance.voice = currentVoice
	utterance.rate = speechConfig.speech_rate || 1
	utterance.pitch = speechConfig.speech_pitch || 1
	utterance.volume = speechConfig.speech_volume || 1
	
	// Visual feedback
	speakButton.classList.add('speaking')
	
	utterance.onend = () => {
		speakButton.classList.remove('speaking')
	}
	
	utterance.onerror = (event) => {
		speakButton.classList.remove('speaking')
		console.error('Speech synthesis error:', event.error)
	}
	
	speechSynth.speak(utterance)
	return true
}

// Get text content for speech based on field
function getFieldText(field, state) {
	switch (field) {
		case 'timer':
			return formatTime(state.remaining)
		case 'top_aux':
			return state.top_aux || ''
		case 'bottom_aux':
			return state.bottom_aux || ''
		case 'middle_aux':
			return state.middle_aux || ''
		default:
			return ''
	}
}

// Current state for speech
let currentState = {}
let continuousSpeechInterval = null

// Update continuous speech based on configuration  
function updateContinuousSpeech(config) {
	// Clear existing interval
	if (continuousSpeechInterval) {
		clearInterval(continuousSpeechInterval)
		continuousSpeechInterval = null
	}

	// Start continuous speech if enabled
	if (config.enable_speech && config.speech_trigger === 'continuous') {
		const interval = (config.speech_interval || 5) * 1000 // Convert to milliseconds
		continuousSpeechInterval = setInterval(() => {
			const fieldToSpeak = config.speech_field || 'timer'
			const textToSpeak = getFieldText(fieldToSpeak, currentState)
			if (textToSpeak) {
				speak(textToSpeak)
			}
		}, interval)
	}
}

socket.on('state', (state) => {
	currentState = state
	speechConfig = state.config

	// Handle hide timer functionality
	if (state.config.hide_timer) {
		document.body.classList.add('timer-hidden')
		timerEl.style.display = 'none'
		middleAuxEl.style.fontSize = state.config.timer_fontsize + 'vw'
		middleAuxEl.style.fontWeight = 'bold'
	} else {
		document.body.classList.remove('timer-hidden')
		timerEl.style.display = 'block'
		middleAuxEl.style.fontSize = state.config.aux_fontsize + 'vw'
		middleAuxEl.style.fontWeight = 'normal'
		
		// Main timer display
		timerEl.textContent = formatTime(state.remaining)
		timerEl.classList.remove('blinking') // Reset blinking state

		// Set color based on thresholds and state
		if (state.remaining <= 0) {
			timerEl.style.color = 'red'
			if (state.state === 'running') {
				timerEl.classList.add('blinking')
			}
		} else if (state.state === 'running') {
			if (state.config.red && state.remaining <= state.config.red) {
				timerEl.style.color = 'red'
			} else if (state.config.amber && state.remaining <= state.config.amber) {
				timerEl.style.color = 'orange'
			} else {
				timerEl.style.color = 'white'
			}
		} else if (state.state === 'paused') {
			timerEl.style.color = 'orange'
		} else { // stopped
			timerEl.style.color = 'white'
		}

		// Apply timer font size
		timerEl.style.fontSize = state.config.timer_fontsize + 'vw'
	}

	// Apply aux font sizes
	topAuxEl.style.fontSize = state.config.aux_fontsize + 'vw'
	bottomAuxEl.style.fontSize = state.config.aux_fontsize + 'vw'
	if (!state.config.hide_timer) {
		middleAuxEl.style.fontSize = state.config.aux_fontsize + 'vw'
	}

	// Aux text content
	topAuxEl.textContent = state.top_aux || ''
	bottomAuxEl.textContent = state.bottom_aux || ''
	middleAuxEl.textContent = state.middle_aux || ''

	// Speech controls visibility
	if (state.config.enable_speech) {
		document.body.classList.remove('speech-disabled')
		speakButton.disabled = false
	} else {
		document.body.classList.add('speech-disabled')
		speakButton.disabled = true
	}

	// Handle continuous speech
	updateContinuousSpeech(state.config)

	// Internal time display
	if (state.config.show_internal_time) {
		internalTimeEl.style.display = 'block'
		internalTimeEl.textContent = new Date().toLocaleTimeString()
		// Update class for corner positioning
		internalTimeEl.className = 'corner ' + state.config.time_corner
	} else {
		internalTimeEl.style.display = 'none'
	}
})

// Speech event handlers
speakButton.addEventListener('click', () => {
	if (currentState.config && currentState.config.enable_speech) {
		const fieldToSpeak = currentState.config.speech_field || 'timer'
		const textToSpeak = getFieldText(fieldToSpeak, currentState)
		if (textToSpeak) {
			speak(textToSpeak)
		}
	}
})

// Listen for automatic speech triggers from server
socket.on('trigger_speech', (data) => {
	if (currentState.config && currentState.config.enable_speech) {
		const fieldToSpeak = currentState.config.speech_field || 'timer'
		const textToSpeak = getFieldText(fieldToSpeak, currentState)
		if (textToSpeak) {
			speak(textToSpeak)
		}
	}
})

// Listen for manual speech requests from actions
socket.on('speak_request', (data) => {
	if (currentState.config && currentState.config.enable_speech) {
		let textToSpeak = ''
		
		if (data.field === 'custom' && data.custom_text) {
			textToSpeak = data.custom_text
		} else {
			textToSpeak = getFieldText(data.field, currentState)
		}
		
		if (textToSpeak) {
			speak(textToSpeak)
		}
	}
})

// Keep internal time updated locally
setInterval(() => {
	if (internalTimeEl.style.display === 'block') {
		internalTimeEl.textContent = new Date().toLocaleTimeString()
	}
}, 1000)

// Clean up continuous speech on page unload
window.addEventListener('beforeunload', () => {
	if (continuousSpeechInterval) {
		clearInterval(continuousSpeechInterval)
		continuousSpeechInterval = null
	}
}) 