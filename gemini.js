/**
 * Utility to convert file/blob to base64
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64String = reader.result.split(',')[1];
      resolve(base64String);
    };
    reader.onerror = error => reject(error);
  });
}

/**
 * Call Gemini 2.5 Flash API to analyze vocabulary from image
 */
export async function analyzeTextbookImage(base64Image, mimeType, apiKey) {
  if (!apiKey) {
    throw new Error("請先設定您的 Gemini API Key！");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const prompt = `你是一個專業的英文學習助理。請分析這張課本隨手拍照片中的所有英文單字或片語。
請提取每個單字的以下資訊：
1. 單字本身 (word) - 例如: "America" 或 "a little"
2. 音標 (phonetic) - IPA 格式，如 "/əˈmɛrɪkə/"
3. 音節拆解 (syllables) - 以 " · " 間隔，如 "Amer · i · ca"。如果單音節單字則直接填寫原單字。
4. 詞性與中文解釋 (explanation) - 如 "(名) 美國"、"(phr.) 一些;少量的"、"(adj.) 受歡迎的;流行的"

請務必嚴格遵循以下 JSON 格式回傳，不要包含任何額外的 Markdown 標記 (\`\`\`json) 或聊天文字：
{
  "words": [
    {
      "word": "America",
      "phonetic": "/əˈmɛrɪkə/",
      "syllables": "Amer · i · ca",
      "explanation": "(n.) 美國"
    }
  ]
}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: base64Image
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.error?.message || `HTTP error! status: ${response.status}`;
    throw new Error(`Gemini API 呼叫失敗: ${errorMessage}`);
  }

  const result = await response.json();
  
  try {
    const jsonText = result.candidates[0].content.parts[0].text;
    const parsedData = JSON.parse(jsonText.trim());
    
    if (!parsedData.words || !Array.isArray(parsedData.words)) {
      throw new Error("Gemini 回傳的資料結構不符合預期。");
    }
    
    return parsedData.words;
  } catch (err) {
    console.error("解析 Gemini 回傳結果時出錯:", err, result);
    throw new Error("無法解析 Gemini 的回傳結果，請確保圖片清晰並重試。");
  }
}
