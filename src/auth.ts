import { Customer, PrismaClient } from "@prisma/client";
import { FastifyRequest } from "fastify";
import { JwtPayload, verify } from "jsonwebtoken";

export const APP_SECRET = 'this is my secret';

export async function authenticateCustomer(prisma: PrismaClient, request: FastifyRequest): Promise<Customer | null> {
    if (request?.headers?.authorization) {
        const token = request.headers.authorization.split(" ")[1];
        const tokenPayload = verify(token, APP_SECRET) as JwtPayload;
        const customerId = tokenPayload.customerId;
        return await prisma.customer.findUnique({
            where: { id: customerId }
        });
    }
    return null;
}