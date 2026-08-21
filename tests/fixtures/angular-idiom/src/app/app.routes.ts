import { Routes } from '@angular/router'
import { HomeComponent } from './home/home.component'
import { ArchivedComponent } from './archived/archived.component'
import { DetailComponent } from './detail/detail.component'

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'archived', component: ArchivedComponent },
  { path: 'detail/:id', component: DetailComponent },
]
