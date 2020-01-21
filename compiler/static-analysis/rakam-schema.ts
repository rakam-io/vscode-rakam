import Avj from 'ajv'
import { HoverInfo } from '../editor';

// var ajv = new Ajv({ allErrors: true });
// var validate = ajv.compile(schema);

export enum SchemaType {
    MODEL,
    MODELS,
    CONFIG,
}

export class HoverService {
    public onHover(path: Array<String>, type: SchemaType): Promise<HoverInfo> {
        return null
    }
}