/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import "katex/dist/katex.min.css";
import { CodeBlock, dracula, github } from "react-code-blocks";

// Register the languages you want to use

interface MarkdownRendererProps {
    content: string;
    theme?: "dark" | "light";
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, theme }) => {
    // You can use a markdown library like 'marked' or 'react-markdown' here
    return (
        <div className="prose prose-slate max-w-none">
            <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm, remarkBreaks]}
                rehypePlugins={[rehypeKatex]}
                components={{
                    h1: ({ node, ...props }) => (
                        <h1 className="text-4xl font-bold" {...props} />
                    ),
                    h2: ({ node, ...props }) => (
                        <h2 className="text-3xl font-bold" {...props} />
                    ),
                    h3: ({ node, ...props }) => (
                        <h3 className="text-2xl font-bold" {...props} />
                    ),
                    h4: ({ node, ...props }) => (
                        <h4 className="text-xl font-bold" {...props} />
                    ),
                    h5: ({ node, ...props }) => (
                        <h5 className="text-lg font-bold" {...props} />
                    ),
                    h6: ({ node, ...props }) => (
                        <h6 className="text-base font-bold" {...props} />
                    ),
                    ul: ({ node, ...props }) => (
                        <ul className="list-disc ml-6" {...props} />
                    ),
                    ol: ({ node, ...props }) => (
                        <ol className="list-decimal ml-6" {...props} />
                    ),
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
                            <div className='text-sm'>
                                <CodeBlock
                                    text={String(children).replace(/\n$/, "")}
                                    language={language}
                                    theme={theme === "dark" ? dracula : github}
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