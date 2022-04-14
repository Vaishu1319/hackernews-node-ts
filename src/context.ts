import { Customer, PrismaClient } from "@prisma/client";
import { FastifyRequest } from "fastify";
import { authenticateCustomer } from "./auth";
import { pubSub } from "./pubsub";

const prisma = new PrismaClient();

export type GraphQLContext = {
    prisma: PrismaClient;
    currentCustomer: Customer | null;
    pubSub: typeof pubSub;
}

export async function contextFactory(
    request: FastifyRequest
): Promise<GraphQLContext> {
    return {
        prisma,
        currentCustomer: await authenticateCustomer(prisma, request),
        pubSub,
    };
}