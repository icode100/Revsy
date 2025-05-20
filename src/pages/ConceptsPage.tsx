import React from 'react';
import Accordion from '../components/Accordion';
interface ConceptPageProps{
    theme:"dark"|"light";
}

interface Concept {
    id: number;
    title: string;
    description: string;
}

const ConceptsPage: React.FunctionComponent<ConceptPageProps> = ({theme}) => {
    const [concepts, setConcepts] = useState<Concept[]>([]);
    return (
        <div className="grid grid-cols-7">
            <div></div>
            <div></div>
            <div></div>
            <div className='col-start-2 col-span-5'>
                
            </div>
            <div></div>
            <div></div>
            <div></div>
        </div>
    );
};

export default ConceptsPage;