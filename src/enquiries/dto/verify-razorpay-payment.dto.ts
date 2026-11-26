import { IsString, Matches, MaxLength } from 'class-validator';

export class VerifyRazorpayPaymentDto {
  @IsString()
  @Matches(/^order_[A-Za-z0-9]+$/)
  @MaxLength(100)
  razorpayOrderId: string;

  @IsString()
  @Matches(/^pay_[A-Za-z0-9]+$/)
  @MaxLength(100)
  razorpayPaymentId: string;

  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  razorpaySignature: string;
}
