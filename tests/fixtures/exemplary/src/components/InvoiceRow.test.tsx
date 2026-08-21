import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InvoiceRow } from './InvoiceRow'

describe('InvoiceRow', () => {
  it('names the order it opens', () => {
    render(<InvoiceRow id="A-1" total={1200} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: /A-1/ })).toBeInTheDocument()
  })
})
