import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SendOtpDto {
    @IsString()
    @IsNotEmpty()
    destination: string; // email ou telefone E.164

    @IsIn(['email', 'whatsapp', 'sms'])
    channel: 'email' | 'whatsapp' | 'sms';

    @IsIn(['login', 'register'])
    purpose: 'login' | 'register';
}
