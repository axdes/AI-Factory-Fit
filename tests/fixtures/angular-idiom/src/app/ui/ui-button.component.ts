import { Component } from '@angular/core'

@Component({
  selector: 'ds-button',
  standalone: true,
  template: '<div class="button"><ng-content /></div>',
})
export class UiButton {}
