import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/svelte'
import HomePage from '../src/HomePage.svelte'

describe('HomePage', () => {
  it('renders', () => {
    expect(render(HomePage)).toBeTruthy()
  })
})
