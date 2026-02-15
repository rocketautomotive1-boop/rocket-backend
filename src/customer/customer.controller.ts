import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, UnauthorizedException, Req, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { LoginCustomerDto } from './dto/login-customer.dto';

// TODO: Add auth guards later. For now, open for testing or use simple Admin guard if needed.
@Controller('customers')
export class CustomerController {
    constructor(private readonly customerService: CustomerService) { }

    @Post('login')
    async login(@Body() loginDto: LoginCustomerDto) {
        const result = await this.customerService.login(loginDto);
        if (!result) {
            throw new UnauthorizedException('Credenciais inválidas');
        }
        return result;
    }

    @Get('auth/google')
    @UseGuards(AuthGuard('google'))
    async googleAuth(@Req() req) { }

    @Get('auth/google/callback')
    @UseGuards(AuthGuard('google'))
    async googleAuthRedirect(@Req() req, @Res() res) {
        const result = await this.customerService.validateGoogleUser(req.user);

        // Redirect to frontend with token
        // In production, use a secure cookie or a temporary code exchange.
        // For this MVP, we pass token in URL or use a client-side popup handler.
        // Let's redirect to frontend with token in query param.
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}/auth/callback?token=${result.access_token}`);
    }

    @Post()
    create(@Body() createCustomerDto: CreateCustomerDto) {
        return this.customerService.create(createCustomerDto);
    }

    @Get()
    findAll() {
        return this.customerService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.customerService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updateCustomerDto: UpdateCustomerDto) {
        return this.customerService.update(id, updateCustomerDto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.customerService.remove(id);
    }
}
