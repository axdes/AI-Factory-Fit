import { Component } from '@angular/core'

@Component({
  selector: 'ds-heading',
  standalone: true,
  template: '<div class="heading"><ng-content /></div>',
})
export class UiHeading {}
