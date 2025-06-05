import React, { useState, useRef, useEffect } from 'react';
import { fetchLeetCodeProblem } from '../services/leetcode';
import { summarizeText } from '../services/ai';
import type { Problem } from './ProblemComponent';

interface ProblemFormProps {
    onSubmit: (data: Problem) => void;
    theme: "dark" | "light";
}

const ProblemForm: React.FC<ProblemFormProps> = ({ onSubmit, theme }) => {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [url, setUrl] = useState('');
    const [isLeetCode, setIsLeetCode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tags, setTags] = useState<string>("");
    const descriptionRef = useRef<HTMLTextAreaElement>(null);

    const handleFetchDescription = async () => {
        try {
            setLoading(true);
            setError(null);
            if (url.length === 0) throw new Error("url cannot be empty")
            const problem = await fetchLeetCodeProblem(url);
            setTitle(problem.title);
            setDescription(problem.description);
            setIsLeetCode(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch problem description.');
            setIsLeetCode(false);
        } finally {
            setLoading(false);
        }
    };

    const handleSummarize = async () => {
        try {
            setLoading(true);
            const summary = await summarizeText(description);
            setDescription(summary);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to summarize description.');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const tag_arr:string[] = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        const tagArr:string[] = tag_arr.length > 3 ? tag_arr.slice(0, 3) : tag_arr;
        onSubmit({ title, description, url, tagArr } as Problem);
        setTitle('');
        setDescription('');
        setUrl('');
        setIsLeetCode(false);
    };

    // Automatically resize the description box to fit content
    useEffect(() => {
        if (descriptionRef.current) {
            descriptionRef.current.style.height = "auto"; // Reset height
            descriptionRef.current.style.height = `${descriptionRef.current.scrollHeight}px`; // Adjust height
        }
    }, [description]);


    return (
        <form
            onSubmit={handleSubmit}
            className={`p-6 rounded-lg shadow-md ${theme === "dark" ? "bg-gray-800 text-white" : "bg-white text-black"
                }`}
        >
            <div className="mb-4">
                <label
                    htmlFor="problem-url"
                    className="block text-sm font-medium mb-2"
                >
                    Problem URL
                </label>
                <div className="flex gap-2">
                    <input
                        id="problem-url"
                        type="text"
                        value={url}
                        required
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="Enter LeetCode problem URL"
                        className={`flex-1 px-4 py-2 rounded border ${theme === "dark"
                                ? "bg-gray-700 border-gray-600 text-white"
                                : "bg-gray-100 border-gray-300 text-black"
                            }`}
                    />

                    <button
                        type="button"
                        onClick={handleFetchDescription}
                        disabled={loading}
                        className={`px-4 py-2 rounded ${loading
                                ? "bg-gray-400 cursor-not-allowed"
                                : theme === "dark"
                                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                                    : "bg-blue-500 hover:bg-blue-600 text-white"
                            }`}
                    >
                        {loading ? "Fetching..." : "Fetch Description"}
                    </button>
                </div>
            </div>
            {error && <p className="text-red-500 mb-4">{error}</p>}
            <div className="mb-4">
                <label
                    htmlFor="problem-title"
                    className="block text-sm font-medium mb-2"
                >
                    Title
                </label>
                <input
                    id="problem-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    className={`w-full px-4 py-2 rounded border ${theme === "dark"
                            ? "bg-gray-700 border-gray-600 text-white"
                            : "bg-gray-100 border-gray-300 text-black"
                        }`}
                />
            </div>
            <div className="mb-4">
                <label
                    htmlFor="problem-description"
                    className="block text-sm font-medium mb-2"
                >
                    Description
                </label>
                <textarea
                    id="problem-description"
                    ref={descriptionRef}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required={!isLeetCode}
                    placeholder={
                        isLeetCode
                            ? "Fetched description will appear here..."
                            : "Enter your own description..."
                    }
                    className={`w-full px-4 py-2 rounded border resize-none ${theme === "dark"
                            ? "bg-gray-700 border-gray-600 text-white"
                            : "bg-gray-100 border-gray-300 text-black"
                        }`}
                    style={{ overflow: "hidden" }}
                />

                {description !== "" ? (<button
                    type="button"
                    onClick={handleSummarize}
                    disabled={!description || loading}
                    className={`mt-2 px-4 py-2 rounded ${loading
                            ? "bg-gray-400 cursor-not-allowed"
                            : theme === "dark"
                                ? "bg-green-600 hover:bg-green-700 text-white"
                                : "bg-green-500 hover:bg-green-600 text-white"
                        }`}
                >
                    {loading ? "Summarizing..." : "Summarize with AI"}
                </button>) : (<button className='mt-2 px-4 py-2 rounded bg-gray-400' disabled={true}> No Description</button>)}
            </div>
            <div className="mb-4">
                <label
                    htmlFor="problem-title"
                    className="block text-sm font-medium mb-2"
                >
                    Tags
                </label>
                <input
                    id="problem-title"
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    required
                    className={`w-full px-4 py-2 rounded border ${theme === "dark"
                            ? "bg-gray-700 border-gray-600 text-white"
                            : "bg-gray-100 border-gray-300 text-black"
                        }`}
                    placeholder="Enter top 3 tags separated by commas"
                />
            </div>
            <button
                type="submit"
                disabled={loading}
                className={`w-full px-4 py-2 rounded ${loading
                        ? "bg-gray-400 cursor-not-allowed"
                        : theme === "dark"
                            ? "bg-purple-600 hover:bg-purple-700 text-white"
                            : "bg-purple-500 hover:bg-purple-600 text-white"
                    }`}
            >
                Submit
            </button>
        </form>
    );
};

export default ProblemForm;