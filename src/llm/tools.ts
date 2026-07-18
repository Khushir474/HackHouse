import type { ToolDef } from './client'

/** Function schemas mirror the frozen Section 5 contracts exactly. */
export const TOOL_DEFS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'financial_agent',
      description:
        'Fetch computed financial due-diligence metrics for a portfolio/prospect company. ' +
        'Use for ANY question involving numbers, metrics, red flags, or financial health.',
      parameters: {
        type: 'object',
        properties: {
          company_name: { type: 'string', description: 'Company name as the user said it' },
          requested_metrics: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['burn_multiple', 'rule_of_40', 'ltv_cac', 'cac_payback', 'runway', 'concentration'],
            },
            description: 'Metrics the user asked about (or all six for a general health check)',
          },
        },
        required: ['company_name', 'requested_metrics'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_agent',
      description:
        'Check availability or book follow-up diligence/reference calls with a company contact. ' +
        'Always check_availability first; book only with a slot_id from a prior availability result.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['check_availability', 'book'] },
          company_name: { type: 'string' },
          contact_role: { type: 'string', enum: ['CFO', 'customer_reference'] },
          preferred_window: { type: 'string', description: 'e.g. "this week", "Thursday afternoon"' },
          slot_id: { type: 'string', description: 'Required for book: the chosen slot UUID' },
        },
        required: ['action', 'company_name', 'contact_role'],
      },
    },
  },
]
