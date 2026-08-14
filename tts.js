class TTSManager {
  constructor() {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.currentRate = 1.0;
    this.voice = null;
    this.audioPlayer = null;
    
    // Attempt to load voices
    this._loadVoices();
    if (this.synth && this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => this._loadVoices();
    }
  }

  _loadVoices() {
    if (!this.synth) return;
    const voices = this.synth.getVoices();
    if (!voices || voices.length === 0) return;

    // Filter strictly for US English (en-US or en_US)
    const usVoices = voices.filter(v => v.lang === 'en-US' || v.lang === 'en_US');

    // Priority 1: Preferred High Quality US English Voices
    const preferredNames = [
      'Google US English',
      'Samantha',
      'Alex',
      'Ava',
      'Allison',
      'Susan',
      'Tom',
      'Jenny',
      'Guy',
      'Microsoft Zira',
      'Microsoft David',
      'Microsoft Mark'
    ];

    let selected = null;
    if (usVoices.length > 0) {
      for (const name of preferredNames) {
        const found = usVoices.find(v => v.name.includes(name));
        if (found) {
          selected = found;
          break;
        }
      }
      if (!selected) {
        selected = usVoices[0];
      }
    } else {
      const enVoices = voices.filter(v => v.lang.startsWith('en'));
      selected = enVoices.find(v => v.lang.includes('US')) || enVoices[0] || voices[0];
    }

    this.voice = selected;
  }

  setRate(rate) {
    this.currentRate = parseFloat(rate);
  }

  getRate() {
    return this.currentRate;
  }

  speak(text, onStartCallback, onEndCallback) {
    this.stop();

    // Clean up text for speech synthesis
    let speechText = text;
    if (text.includes('/')) {
      speechText = text.split('/').map(t => t.trim()).join(' or ');
    }

    // Attempt Web Speech API first with strict en-US voice
    if (this.synth) {
      if (!this.voice) {
        this._loadVoices();
      }

      try {
        const utterance = new SpeechSynthesisUtterance(speechText);
        if (this.voice) {
          utterance.voice = this.voice;
        }
        utterance.lang = 'en-US'; // Explicitly lock General American
        utterance.rate = this.currentRate;

        if (onStartCallback) utterance.onstart = onStartCallback;
        
        let hasEnded = false;
        const safeEnd = () => {
          if (!hasEnded) {
            hasEnded = true;
            if (onEndCallback) onEndCallback();
          }
        };

        utterance.onend = safeEnd;
        utterance.onerror = () => {
          // Fallback to Google Cloud/Translate TTS if Web Speech throws error
          this._speakAudioFallback(speechText, onStartCallback, safeEnd);
        };

        this.synth.speak(utterance);
        return;
      } catch (err) {
        console.warn("Web Speech API failed, switching to Google TTS fallback...", err);
      }
    }

    // Fallback to Google Translate/Cloud TTS en-US endpoint if Web Speech fails or is unsupported
    this._speakAudioFallback(speechText, onStartCallback, onEndCallback);
  }

  _speakAudioFallback(text, onStartCallback, onEndCallback) {
    try {
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en-US&client=tw-ob`;
      
      if (!this.audioPlayer) {
        this.audioPlayer = new Audio();
      }
      
      this.audioPlayer.src = ttsUrl;
      this.audioPlayer.playbackRate = this.currentRate;

      if (onStartCallback) {
        this.audioPlayer.onplay = onStartCallback;
      }
      if (onEndCallback) {
        this.audioPlayer.onended = onEndCallback;
        this.audioPlayer.onerror = onEndCallback;
      }

      this.audioPlayer.play().catch(err => {
        console.error("Audio playback error:", err);
        if (onEndCallback) onEndCallback();
      });
    } catch (e) {
      console.error("Fallback TTS failed:", e);
      if (onEndCallback) onEndCallback();
    }
  }

  stop() {
    if (this.synth) {
      this.synth.cancel();
    }
    if (this.audioPlayer) {
      this.audioPlayer.pause();
      this.audioPlayer.currentTime = 0;
    }
  }
}

export const tts = new TTSManager();
