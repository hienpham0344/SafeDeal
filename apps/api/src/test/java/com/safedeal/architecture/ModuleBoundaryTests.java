package com.safedeal.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.junit.ArchTests;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;

/**
 * Guards the modular monolith boundaries: no package cycles and no cross-module imports of
 * another feature's internals. Modules talk through their public {@code api}/{@code application}
 * types (or documented ports), which keeps the codebase extractable later if needed.
 */
@AnalyzeClasses(packages = "com.safedeal", importOptions = ImportOption.DoNotIncludeTests.class)
class ModuleBoundaryTests {

    private static final String[] FEATURE_MODULES = {
            "auth", "user", "deal", "agreement", "negotiation", "escrow",
            "warranty", "dispute", "subscription", "ai", "notification", "blockchain"
    };

    private static final JavaClasses CLASSES =
            new ClassFileImporter().importPackages("com.safedeal");

    @ArchTest
    static final ArchRule no_package_cycles = slices()
            .matching("com.safedeal.(*)..")
            .should()
            .beFreeOfCycles();

    @Test
    void modulesDoNotReachIntoAnotherModulesDomainOrInfrastructure() {
        for (String module : FEATURE_MODULES) {
            ArchRule rule = noClasses()
                    .that().resideOutsideOfPackage("com.safedeal." + module + "..")
                    .and().resideInAPackage("com.safedeal..")
                    .should().dependOnClassesThat()
                    .resideInAnyPackage(
                            "com.safedeal." + module + ".domain..",
                            "com.safedeal." + module + ".infrastructure..");
            rule.check(CLASSES);
        }
    }
}
