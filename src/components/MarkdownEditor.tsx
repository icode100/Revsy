// /* eslint-disable @typescript-eslint/no-unused-vars */
import { useState } from "react";
import "katex/dist/katex.min.css";
import MarkdownRenderer from "./MarkdownRenderer";



interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function MarkdownEditor({
  value,
  onChange,
  theme = "light", // Default theme is light
}: MarkdownEditorProps & { theme: "dark" | "light" }) {
  const [isPreview, setIsPreview] = useState(false);

  // Function to handle the Tab key press
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault(); // Prevent the default tab behavior (focus change)
      const textarea = e.target as HTMLTextAreaElement;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      // Insert 4 spaces at the cursor position
      const updatedValue =
        value.substring(0, start) + "    " + value.substring(end);
      onChange(updatedValue);

      // Move the cursor to the right after the inserted spaces
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 4;
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
    <div
      className={`border rounded-lg shadow-sm ${theme === "dark" ? "bg-gray-800 text-white" : "bg-white text-black"
        }`}
    >
      <div
        className={`flex flex-col p-2 border-b ${theme === "dark" ? "bg-gray-700" : "bg-gray-50"
          }`}
      >
        <div className="flex justify-between mb-2">
          <div className="space-x-2">
            <button
              className={`px-3 py-1 rounded ${!isPreview
                ? theme === "dark"
                  ? "bg-blue-500 text-white"
                  : "bg-blue-500 text-white"
                : theme === "dark"
                  ? "bg-gray-600 text-white"
                  : "bg-gray-200"
                }`}
              onClick={() => setIsPreview(false)}
            >
              <span className="material-icons">edit</span>
            </button>
            <button
              className={`px-3 py-1 rounded ${isPreview
                ? theme === "dark"
                  ? "bg-blue-500 text-white"
                  : "bg-blue-500 text-white"
                : theme === "dark"
                  ? "bg-gray-600 text-white"
                  : "bg-gray-200"
                }`}
              onClick={() => setIsPreview(true)}
            >
              <span className="material-icons">visibility</span>
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          {/* Heading levels */}
          <div className="flex space-x-1 border-r pr-2">
            {[1, 2, 3, 4, 5, 6].map((level) => (
              <button
                key={level}
                className={`px-2 py-1 rounded text-sm font-semibold ${theme === "dark"
                  ? "text-gray-300 hover:bg-gray-600"
                  : "text-gray-600 hover:bg-gray-200"
                  } font-mono`}
                onClick={() => handleAddHeading(level)}
                title={`Heading ${level}`}
              >
                H{level}
              </button>
            ))}
          </div>

          {/* Existing formatting buttons */}
          <div className="flex space-x-2">
            <button
              className={`px-2 py-1 rounded ${theme === "dark"
                ? "text-gray-300 hover:bg-gray-600"
                : "text-gray-600 hover:bg-gray-200"
                } font-mono`}
              onClick={() => onChange(value + "**bold**")}
            >
              B
            </button>
            <button
              className={`px-2 py-1 rounded ${theme === "dark"
                ? "text-gray-300 hover:bg-gray-600"
                : "text-gray-600 hover:bg-gray-200"
                } font-mono`}
              onClick={() => onChange(value + "*italic*")}
            >
              I
            </button>
            <button
              className={`px-2 py-1 rounded ${theme === "dark"
                ? "text-gray-300 hover:bg-gray-600"
                : "text-gray-600 hover:bg-gray-200"
                }`}
              onClick={() => onChange(value + "`code`")}
            >
              {"</>"}
            </button>
            <button
              className={`px-2 py-1 rounded ${theme === "dark"
                ? "text-gray-300 hover:bg-gray-600"
                : "text-gray-600 hover:bg-gray-200"
                } font-serif`}
              onClick={() => handleAddList("bullet")}
            >
              •
            </button>
            <button
              className={`px-2 py-1 rounded ${theme === "dark"
                ? "text-gray-300 hover:bg-gray-600"
                : "text-gray-600 hover:bg-gray-200"
                }`}
              onClick={() => handleAddList("number")}
            >
              1.
            </button>


            <button
              className={`px-2 py-1 rounded ${theme === "dark"
                ? "text-gray-300 hover:bg-gray-600"
                : "text-gray-600 hover:bg-gray-200"
                } font-serif`}
              onClick={() => onChange(value + "\n$$ $$\n")}
              title="Insert Math Equation"
            >
              Σ
            </button>
          </div>
        </div>
      </div>

      <div className="p-4">
        {isPreview ? (
          <MarkdownRenderer content={value} theme={theme}/>
        ) : (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className={`w-full h-64 p-2 border rounded font-sans ${theme === "dark"
              ? "bg-gray-800 text-white border-gray-600 placeholder-gray-400"
              : "bg-white text-black border-gray-300 placeholder-gray-600"
              }`}
            placeholder="Write your notes (markdown supported)"
          />
        )}
      </div>
    </div>
  );
}