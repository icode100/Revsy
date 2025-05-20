/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import "katex/dist/katex.min.css";

// Register the languages you want to use
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("java", java);
SyntaxHighlighter.registerLanguage("cpp", cpp);

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
                            <SyntaxHighlighter
                                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                                // @ts-expect-error
                                style={theme === "dark" ? oneDark : oneLight} 
                                language={language}
                                PreTag="div"
                                {...(props as React.HTMLProps<HTMLDivElement>)}
                            >
                                {String(children).replace(/\n$/, "")}
                            </SyntaxHighlighter>
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