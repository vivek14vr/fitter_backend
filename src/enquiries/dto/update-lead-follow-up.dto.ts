import { IsIn } from 'class-validator';

export class UpdateLeadFollowUpDto {
  @IsIn(['new', 'contacted', 'closed'])
  followUpStatus: 'new' | 'contacted' | 'closed';
}
