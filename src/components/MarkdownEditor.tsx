import { useState, useRef, useEffect } from "react";
import "katex/dist/katex.min.css";
import MarkdownRenderer from "./MarkdownRenderer";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  theme: "dark" | "light";
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ value, onChange, theme }) => {
  const [isPreview, setIsPreview] = useState(false);

  const historyRef = useRef<string[]>([value]);
  const historyIndexRef = useRef<number>(0);
  const isUndoingRef = useRef<boolean>(false);

  const pushToHistory = (val: string) => {
    const hist = historyRef.current;
    const idx = historyIndexRef.current;
    if (hist[idx] === val) return;
    
    const newHist = hist.slice(0, idx + 1);
    newHist.push(val);
    if (newHist.length > 50) newHist.shift();
    
    historyRef.current = newHist;
    historyIndexRef.current = newHist.length - 1;
  };

  const handleUndo = () => {
    if (historyIndexRef.current > 0) {
      isUndoingRef.current = true;
      historyIndexRef.current -= 1;
      onChange(historyRef.current[historyIndexRef.current]);
    }
  };

  const handleRedo = () => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      isUndoingRef.current = true;
      historyIndexRef.current += 1;
      onChange(historyRef.current[historyIndexRef.current]);
    }
  };

  const updateValue = (newValue: string, saveInstantly = false) => {
    if (saveInstantly) {
      pushToHistory(value);
      pushToHistory(newValue);
      isUndoingRef.current = true;
    }
    onChange(newValue);
  };

  useEffect(() => {
    if (isUndoingRef.current) {
      isUndoingRef.current = false;
      return;
    }
    
    const timeout = setTimeout(() => {
      pushToHistory(value);
    }, 500);

    return () => clearTimeout(timeout);
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.target as HTMLTextAreaElement;
    const { selectionStart, selectionEnd, value: text } = textarea;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      handleRedo();
      return;
    }

    const pairs: Record<string, string> = {
      "(": ")",
      "[": "]",
      "{": "}",
      '"': '"',
      "'": "'",
      "`": "`",
      "$": "$",
    };

    const closingChars = [")", "]", "}", '"', "'", "`", "$"];
    if (
      closingChars.includes(e.key) &&
      selectionStart === selectionEnd &&
      text.charAt(selectionStart) === e.key
    ) {
      e.preventDefault();
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart + 1;
      }, 0);
      return;
    }

    if (pairs[e.key]) {
      e.preventDefault();
      const openChar = e.key;
      const closeChar = pairs[openChar];

      if (selectionStart !== selectionEnd) {
        const selectedText = text.substring(selectionStart, selectionEnd);
        const before = text.substring(0, selectionStart);
        const after = text.substring(selectionEnd);

        const updatedValue = before + openChar + selectedText + closeChar + after;
        updateValue(updatedValue, true);

        setTimeout(() => {
          textarea.selectionStart = selectionStart + 1;
          textarea.selectionEnd = selectionEnd + 1;
        }, 0);
      } else {
        const before = text.substring(0, selectionStart);
        const after = text.substring(selectionEnd);

        const updatedValue = before + openChar + closeChar + after;
        updateValue(updatedValue, true);

        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = selectionStart + 1;
        }, 0);
      }
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const updatedValue =
        text.substring(0, selectionStart) + "    " + text.substring(selectionEnd);
      updateValue(updatedValue, true);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart + 4;
      }, 0);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();

      const beforeCursor = text.substring(0, selectionStart);
      const afterCursor = text.substring(selectionEnd);
      const lines = beforeCursor.split("\n");
      const currentLine = lines[lines.length - 1];

      const indentMatch = currentLine.match(/^(\s*)/);
      const bulletMatch = currentLine.match(/^(\s*)([-*+]|\d+\.)\s+/);

      const indent = indentMatch ? indentMatch[1] : "";
      const bulletPrefix = bulletMatch ? `${bulletMatch[2]} ` : "";

      const isEmptyBullet = bulletMatch && currentLine.trim() === bulletPrefix.trim();

      const insert = "\n" + (isEmptyBullet ? indent : indent + bulletPrefix);
      const updatedValue = beforeCursor + insert + afterCursor;

      updateValue(updatedValue, true);

      setTimeout(() => {
        const pos = selectionStart + insert.length;
        textarea.selectionStart = textarea.selectionEnd = pos;
      }, 0);
    }
  };

  const handleAddList = (type: "bullet" | "number" | "alphabet") => {
    let prefix = "";
    if (type === "bullet") {
      prefix = "- ";
    } else if (type === "number") {
      prefix = "1. ";
    } else if (type === "alphabet") {
      const lines = value.split("\n");
      const lastLine = lines[lines.length - 1];
      const match = lastLine.match(/^([a-zA-Z])\.\s/);
      const nextChar = match
        ? String.fromCharCode(match[1].charCodeAt(0) + 1)
        : "a";
      prefix = `${nextChar}. `;
    }
    const updatedValue = value.endsWith("\n") ? value : value + "\n";
    updateValue(updatedValue + prefix, true);
  };

  const handleAddHeading = (level: number) => {
    const prefix = "#".repeat(level) + " ";
    updateValue(value + "\n" + prefix, true);
  };

  return (
    <div className="editor-glass shadow-sm">
      <div className="editor-toolbar">
        <div className="flex justify-between mb-2">
          <div className="space-x-2">
            <button
              className={`editor-btn ${!isPreview ? 'editor-btn-active' : ''}`}
              onClick={() => setIsPreview(false)}
            >
              <div className="flex items-center gap-1">
                <span className="material-icons text-sm">edit</span>
                <span>Edit</span>
              </div>
            </button>
            <button
              className={`editor-btn ${isPreview ? 'editor-btn-active' : ''}`}
              onClick={() => setIsPreview(true)}
            >
              <div className="flex items-center gap-1">
                <span className="material-icons text-sm">visibility</span>
                <span>Preview</span>
              </div>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex space-x-1 border-r border-gray-300 dark:border-white/10 pr-2">
            <button className="editor-btn" onClick={handleUndo} title="Undo (Ctrl+Z)">
              <span className="material-icons text-sm">undo</span>
            </button>
            <button className="editor-btn" onClick={handleRedo} title="Redo (Ctrl+Y)">
              <span className="material-icons text-sm">redo</span>
            </button>
          </div>

          <div className="flex space-x-1 border-r border-gray-300 dark:border-white/10 pr-2">
            {[1, 2, 3].map((level) => (
              <button
                key={level}
                className="editor-btn font-mono"
                onClick={() => handleAddHeading(level)}
                title={`Heading ${level}`}
              >
                H{level}
              </button>
            ))}
          </div>

          <div className="flex space-x-1">
            <button
              className="editor-btn font-mono font-bold"
              onClick={() => updateValue(value + "**bold**", true)}
              title="Bold"
            >
              B
            </button>
            <button
              className="editor-btn font-mono italic"
              onClick={() => updateValue(value + "*italic*", true)}
              title="Italic"
            >
              I
            </button>
            <button
              className="editor-btn font-mono"
              onClick={() => updateValue(value + "`code`", true)}
              title="Inline Code"
            >
              {"</>"}
            </button>
            <button
              className="editor-btn font-serif"
              onClick={() => handleAddList("bullet")}
              title="Bullet List"
            >
              •
            </button>
            <button
              className="editor-btn"
              onClick={() => handleAddList("number")}
              title="Numbered List"
            >
              1.
            </button>
            <button
              className="editor-btn font-serif"
              onClick={() => updateValue(value + "\n$$ $$\n", true)}
              title="Insert Math Equation"
            >
              Σ
            </button>
          </div>
        </div>
      </div>

      <div className="flex-grow">
        {isPreview ? (
          <div className="p-2">
             <MarkdownRenderer content={value} theme={theme} />
          </div>
        ) : (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="editor-textarea"
            placeholder="Write your notes (markdown supported)..."
          />
        )}
      </div>
    </div>
  );
}

export default MarkdownEditor;