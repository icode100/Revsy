/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import "katex/dist/katex.min.css";
import { CodeBlock, vs2015, googlecode } from "react-code-blocks";

interface MarkdownRendererProps {
    content: string;
    theme?: "dark" | "light";
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, theme }) => {
    return (
        // Replaced 'prose' with our custom 'markdown-content' class for unified styling
        <div className="markdown-content p-4">
            <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm, remarkBreaks]}
                rehypePlugins={[rehypeKatex]}
                components={{
                    // Only intercept code blocks for syntax highlighting.
                    // All other elements (h1, p, ul, ol, blockquote) are styled via CSS in style.css
                    code({
                        node,
                        inline,
                        className,
                        children,
                        ...props
                    }: React.ComponentProps<"code"> & { inline?: boolean; node?: unknown }) {
                        const match = /language-(\w+)/.exec(className || "");
                        const language = match ? match[1] : "";

                        return !inline && match ? (
                            <div className='code-block-wrapper'>
                                <CodeBlock
                                    text={String(children).replace(/\n$/, "")}
                                    language={language}
                                    showLineNumbers={false}
                                    theme={theme === "dark" ? vs2015 : googlecode}
                                />
                            </div>
                        ) : (
                            <code className={className} {...props}>
                                {children}
                            </code>
                        );
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
};

export default MarkdownRenderer;