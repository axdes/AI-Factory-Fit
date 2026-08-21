import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OrderRow } from './OrderRow'

describe('OrderRow', () => {
  it('names the order it opens', () => {
    render(<OrderRow id="A-1" total={1200} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: /A-1/ })).toBeInTheDocument()
  })
})
