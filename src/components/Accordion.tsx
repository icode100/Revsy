import React from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import { summarizeText } from '../services/ai';

interface AccordionProps {
    title: React.ReactNode;
    url: string;
    description: string;
    tagArr: string[],
    theme?: "dark" | "light";
    setError: (error: string) => void;
    onExpand: () => void;
}

const Accordion: React.FC<AccordionProps> = ({ url, title, tagArr, description, theme, setError, onExpand }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [isSummarizing, setIsSummarizing] = React.useState(false);
    const [summary, setSummary] = React.useState<string>("");

    const toggleAccordion = () => setIsOpen((prev) => !prev);

    const handleSummarize = async () => {
        setLoading(true);
        try {
            setIsSummarizing(true);
            const summ = await summarizeText(description);
            setSummary(summ);
        } catch (error) {
            console.error("Error summarizing:", error);
            setError("Error summarizing");
        } finally {
            setLoading(false);
        }
    };

    // Helper: Determine difficulty for the accent border
    const getDifficultyBorder = (tags: string[]) => {
        const lowerTags = tags.map(t => t.toLowerCase());
        if (lowerTags.includes('hard')) return 'border-hard';
        if (lowerTags.includes('medium')) return 'border-medium';
        if (lowerTags.includes('easy')) return 'border-easy';
        if (lowerTags.includes('heap')) return 'border-maroon';
        if (lowerTags.includes('dp')) return 'border-violet';
        if (lowerTags.includes('graph')) return 'border-cyan';
        if (lowerTags.includes('tree')) return 'border-orange';
        if (lowerTags.includes('bit-manipulation')) return 'border-ocean';
        if (lowerTags.includes('greedy')) return 'border-purple';
        if (lowerTags.includes('sorting')) return 'border-golden';

        return 'border-default';
    };

    // Helper: Determine badge style for individual tags
    const getBadgeStyle = (tag: string) => {
        const t = tag.toLowerCase();
        if (t === 'hard') return 'badge-red';
        if (t === 'medium') return 'badge-yellow';
        if (t === 'easy') return 'badge-green';
        if (t === 'heap') return 'badge-maroon';
        if (t==='dp') return 'badge-violet';
        if (t==='graph') return 'badge-cyan';
        if (t==='tree') return 'badge-orange';
        if (t==='bit-manipulation') return 'badge-ocean';
        if (t==='greedy') return 'badge-purple';
        if (t==='sorting') return 'badge-golden'
        return 'badge-gray';
    };

    const borderClass = getDifficultyBorder(tagArr);

    return (
        <div className={`accordion-glass ${borderClass}`}>
            <button
                className={`accordion-header group ${isOpen ? 'bg-gray-50/50 dark:bg-white/5' : ''}`}
                onClick={toggleAccordion}
            >
                <div className="flex items-center justify-between w-full">
                    <span className='font-medium text-lg text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors'>
                        <a href={url}>{title}</a>
                    </span>
                    
                    <div className="flex items-center gap-3">
                        {tagArr.length > 0 && (
                            <div className="hidden sm:flex flex-wrap gap-2 justify-end">
                                {tagArr.map((tag, index) => (
                                    <span key={index} className={`badge ${getBadgeStyle(tag)}`}>
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        )}
                        <span className={`material-icons text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
                            expand_more
                        </span>
                    </div>
                </div>
                {/* Mobile tags row */}
                {tagArr.length > 0 && (
                     <div className="sm:hidden mt-2 flex flex-wrap gap-2">
                        {tagArr.map((tag, index) => (
                            <span key={index} className={`badge ${getBadgeStyle(tag)}`}>
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
            </button>

            <div 
                className={`grid transition-all duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            >
                <div className="overflow-hidden">
                    {/* Manually applying custom-scrollbar class here */}
                    <div className="accordion-scroll-box custom-scrollbar">
                        <MarkdownRenderer content={isSummarizing ? summary : description} theme={theme} />
                    </div>
                    
                    {/* Footer Actions */}
                    <div className="accordion-actions">
                         <button 
                            className="btn-expand"
                            onClick={(e) => { e.stopPropagation(); onExpand(); }}
                        >
                            <span className="material-icons text-xs">open_in_full</span>
                            Expand
                        </button>

                        <button 
                            className={`btn-summarize ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                            disabled={loading} 
                            onClick={(e) => { e.stopPropagation(); handleSummarize(); }}
                        >
                            <span className="material-icons text-xs">summarize</span>
                            {loading ? 'Thinking...' : 'Summarize AI'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Accordion;