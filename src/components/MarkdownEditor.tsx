import { useState } from "react";
import "katex/dist/katex.min.css";
import MarkdownRenderer from "./MarkdownRenderer";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  theme: "dark" | "light"
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ value, onChange, theme }) => {
  const [isPreview, setIsPreview] = useState(false);

  // Function to handle the Tab key press
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.target as HTMLTextAreaElement;
    const { selectionStart, selectionEnd, value: text } = textarea;

    // Handle Tab key for indentation
    if (e.key === "Tab") {
      e.preventDefault();
      const updatedValue =
        text.substring(0, selectionStart) + "    " + text.substring(selectionEnd);
      onChange(updatedValue);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart + 4;
      }, 0);
      return;
    }

    // Handle Enter key for auto-bullet or indent
    if (e.key === "Enter") {
      e.preventDefault();

      // Get current line until cursor
      const beforeCursor = text.substring(0, selectionStart);
      const afterCursor = text.substring(selectionEnd);
      const lines = beforeCursor.split("\n");
      const currentLine = lines[lines.length - 1];

      const indentMatch = currentLine.match(/^(\s*)/); // leading spaces/tabs
      const bulletMatch = currentLine.match(/^(\s*)([-*+]|\d+\.)\s+/);

      const indent = indentMatch ? indentMatch[1] : "";
      const bulletPrefix = bulletMatch ? `${bulletMatch[2]} ` : "";

      // If it's an empty bullet, remove the prefix instead of continuing it
      const isEmptyBullet = bulletMatch && currentLine.trim() === bulletPrefix.trim();

      const insert =
        "\n" + (isEmptyBullet ? indent : indent + bulletPrefix);

      const updatedValue = beforeCursor + insert + afterCursor;

      onChange(updatedValue);

      // Set cursor after inserted prefix
      setTimeout(() => {
        const pos = selectionStart + insert.length;
        textarea.selectionStart = textarea.selectionEnd = pos;
      }, 0);
    }
  };


  // Add list button handler
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
    onChange(updatedValue + prefix);
  };

  // Add heading handler
  const handleAddHeading = (level: number) => {
    const prefix = "#".repeat(level) + " ";
    onChange(value + "\n" + prefix);
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
          {/* Heading levels */}
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

          {/* Formatting buttons */}
          <div className="flex space-x-1">
            <button
              className="editor-btn font-mono font-bold"
              onClick={() => onChange(value + "**bold**")}
              title="Bold"
            >
              B
            </button>
            <button
              className="editor-btn font-mono italic"
              onClick={() => onChange(value + "*italic*")}
              title="Italic"
            >
              I
            </button>
            <button
              className="editor-btn font-mono"
              onClick={() => onChange(value + "`code`")}
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
              onClick={() => onChange(value + "\n$$ $$\n")}
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