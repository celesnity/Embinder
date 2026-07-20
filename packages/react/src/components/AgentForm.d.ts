import { type ComponentPropsWithoutRef, type ReactElement } from 'react';
import type { ZodTypeAny } from 'zod';
export interface AgentFormProps extends Omit<ComponentPropsWithoutRef<'form'>, 'onSubmit'> {
    name: string;
    description: string;
    fields: Record<string, ZodTypeAny>;
    onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
    destructive?: boolean;
    title?: string;
}
export declare function AgentForm({ name, title, description, fields, onSubmit, destructive, children, ...formProps }: AgentFormProps): ReactElement;
