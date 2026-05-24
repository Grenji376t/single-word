class TTSManager {
  constructor() {
    this.synth = window.speechSynthesis;
    this.currentRate = 1.0;
    this.voice = null;
    
    // Attempt to load voices
    this._loadVoices();
    if (this.synth && this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => this._loadVoices();
    }
  }

  _loadVoices() {
    if (!this.synth) return;
    const voices = this.synth.getVoices();
    // Prefer Google US English, otherwise any English voice
    this.voice = voices.find(v => v.lang === 'en-US' && v.name.includes('Google')) || 
                 voices.find(v => v.lang.startsWith('en-US')) ||
                 voices.find(v => v.lang.startsWith('en')) ||
                 voices[0];
  }

  setRate(rate) {
    this.currentRate = parseFloat(rate);
  }

  getRate() {
    return this.currentRate;
  }

  speak(text, onStartCallback, onEndCallback) {
    if (!this.synth) {
      alert("您的瀏覽器不支援語音合成功能 (Text-to-Speech)。");
      return;
    }

    // Cancel current speaking
    this.synth.cancel();

    // Clean up text for speech synthesis (e.g. "will / would" -> "will or would", "spend / spent" -> "spend or spent")
    let speechText = text;
    if (text.includes('/')) {
      speechText = text.split('/').map(t => t.trim()).join(' or ');
    }

    const utterance = new SpeechSynthesisUtterance(speechText);
    if (this.voice) {
      utterance.voice = this.voice;
    }
    
    utterance.rate = this.currentRate;
    utterance.lang = 'en-US';

    if (onStartCallback) {
      utterance.onstart = onStartCallback;
    }
    if (onEndCallback) {
      utterance.onend = onEndCallback;
      utterance.onerror = onEndCallback; // trigger end on error to prevent stuck state
    }

    this.synth.speak(utterance);
  }

  stop() {
    if (this.synth) {
      this.synth.cancel();
    }
  }
}

export const tts = new TTSManager();
