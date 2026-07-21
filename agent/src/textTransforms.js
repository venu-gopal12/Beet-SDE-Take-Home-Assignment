const thoughtStartTag = "<|channel>thought";

const partialThoughtTagLength = (text) => {
  const maxLength = Math.min(text.length, thoughtStartTag.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (text.endsWith(thoughtStartTag.slice(0, length))) return length;
  }
  return 0;
};

export const stripGemmaThoughtChannels = (text) =>
  new ReadableStream({
    async start(controller) {
      let buffer = "";
      try {
        for await (const chunk of text) {
          buffer += chunk;
          buffer = buffer.replace(/<\|channel>thought[\s\S]*?<channel\|>/g, "");
          const openThoughtIndex = buffer.lastIndexOf(thoughtStartTag);
          if (openThoughtIndex >= 0) {
            const safeText = buffer.slice(0, openThoughtIndex);
            if (safeText) controller.enqueue(safeText);
            buffer = buffer.slice(openThoughtIndex);
          } else if (buffer) {
            const keepLength = partialThoughtTagLength(buffer);
            const safeText = keepLength ? buffer.slice(0, -keepLength) : buffer;
            if (safeText) controller.enqueue(safeText);
            buffer = keepLength ? buffer.slice(-keepLength) : "";
          }
        }
        buffer = buffer.replace(/<\|channel>thought[\s\S]*$/g, "");
        if (buffer) controller.enqueue(buffer);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
