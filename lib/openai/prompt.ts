interface PromptConfig {
  language?: string
  shouldShowTimestamp?: boolean
}
const PROMPT_LANGUAGE_MAP = {
  'English': "UK English",
  "中文": "Simplified Chinese",
  "繁體中文": "Traditional Chinese",
  "日本語": "Japanese",
  "Italiano": "Italian",
  "Deutsch": "German",
  "Español": "Spanish",
  "Français": "French",
  "Nederlands": "Dutch",
  "한국어": "Korean",
  "ភាសាខ្មែរ":"Khmer",
  "हिंदी" : "Hindi"
}
export function getSummaryPrompt(title: string, transcript: any, promptConfig: PromptConfig) {
  console.log('prompt ', promptConfig);
  const { language = '中文', shouldShowTimestamp } = promptConfig
  const betterPrompt = `我希望你是一名专业的视频内容编辑，帮我用${language}总结视频的内容精华。请你将视频字幕文本进行总结，然后以无序列表的方式返回，不要超过5条。记得不要重复句子，确保所有的句子都足够精简，清晰完整，祝你好运！`
  const promptWithTimestamp = `我希望你是一名专业的视频内容编辑，帮我用${language}总结视频的内容精华。请先用一句简短的话总结视频梗概。然后再请你将视频字幕文本进行总结，在每句话的最前面加上时间戳（类似 10:24），每句话开头只需要一个开始时间。请你以无序列表的方式返回，请注意不要超过5条哦，确保所有的句子都足够精简，清晰完整，祝你好运！`;

  return `标题: "${title
    ?.replace(/\n+/g, " ")
    .trim()}"\n视频字幕: "${truncateTranscript(transcript)
    .replace(/\n+/g, " ")
    .trim()}"\n${(shouldShowTimestamp ? process.env.NEXT_PUBLIC_PROMPT_STRING : betterPrompt)}`;
  }

  // Seems like 15,000 bytes is the limit for the prompt
  const limit = 7000; // 1000 is a buffer

  export function getChunckedTranscripts(textData: { text: any; index: any; }[], textDataOriginal: any[]) {

    // [Thought Process]
    // (1) If text is longer than limit, then split it into chunks (even numbered chunks)
    // (2) Repeat until it's under limit
    // (3) Then, try to fill the remaining space with some text
    // (eg. 15,000 => 7,500 is too much chuncked, so fill the rest with some text)

    let result = "";
    const text = textData.sort((a, b) => a.index - b.index).map(t => t.text).join(" ");
    const bytes = textToBinaryString(text).length;

    if (bytes > limit) {
      // Get only even numbered chunks from textArr
      const evenTextData = textData.filter((t, i) => i % 2 === 0);
      result = getChunckedTranscripts(evenTextData, textDataOriginal);
    } else {
      // Check if any array items can be added to result to make it under limit but really close to it
      if (textDataOriginal.length !== textData.length) {
        textDataOriginal.forEach((obj, i) => {

          if (textData.some(t => t.text === obj.text)) { return; }

          textData.push(obj);

          const newText = textData.sort((a, b) => a.index - b.index).map(t => t.text).join(" ");
          const newBytes = textToBinaryString(newText).length;

          if (newBytes < limit) {

            const nextText = textDataOriginal[i + 1];
            const nextTextBytes = textToBinaryString(nextText.text).length;

            if (newBytes + nextTextBytes > limit) {
              const overRate = ((newBytes + nextTextBytes) - limit) / nextTextBytes;
              const chunkedText = nextText.text.substring(0, Math.floor(nextText.text.length * overRate));
              textData.push({ text: chunkedText, index: nextText.index });
              result = textData.sort((a, b) => a.index - b.index).map(t => t.text).join(" ");
            } else {
              result = newText;
            }
          }

        })
      } else {
        result = text;
      }
    }

    const originalText = textDataOriginal.sort((a, b) => a.index - b.index).map(t => t.text).join(" ");
    return (result == "") ? originalText : result; // Just in case the result is empty

  }

  function truncateTranscript(str:string) {
    const bytes = textToBinaryString(str).length;
    if (bytes > limit) {
      const ratio = limit / bytes;
      const newStr = str.substring(0, str.length * ratio);
      return newStr;
    }
    return str;
  }

  function textToBinaryString(str:string) {
    let escstr = decodeURIComponent(encodeURIComponent(escape(str)));
    let binstr = escstr.replace(/%([0-9A-F]{2})/gi, function (match, hex) {
      let i = parseInt(hex, 16);
      return String.fromCharCode(i);
    });
    return binstr;
  }
